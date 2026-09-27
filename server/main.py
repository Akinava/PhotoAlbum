import argparse
import ast
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from dataclasses import MISSING, asdict, dataclass, field, fields, is_dataclass
from email.message import Message
from email.parser import HeaderParser
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import NamedTuple, get_args, get_origin
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError

BASE_DIR = Path(__file__).resolve().parent
ALBUM_DIR = BASE_DIR.parent / "album"
JSON_DIR = ALBUM_DIR / "json"
IMGS_DIR = ALBUM_DIR / "imgs"
ICONS_DIR = ALBUM_DIR / "icons"
VIDEOS_DIR = ALBUM_DIR / "videos"
ICON_HEIGHT = 100  # превью в альбоме — 100 px по высоте
# теги — uuid4 без дефисов (корневой «Главная страница» — 32 нуля), фото — sha256 файла,
# чтобы одно фото нельзя было загрузить дважды (имя функции set_<id> должно быть идентификатором JS)
ID_RE = re.compile(r"^([0-9a-f]{32}|[0-9a-f]{64})$")
KEY_ORDER = ["type", "media", "title", "parents", "children", "info"]

STATIC_DIR = BASE_DIR / "static"
# запросы обрабатываются в потоках: чтение-изменение-запись album/json делаем под этой блокировкой
DATA_LOCK = threading.Lock()


class HTTPException(Exception):
    def __init__(self, status_code: int, detail):
        super().__init__(status_code, detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class TagIn:
    title: str
    info: str = ""
    parents: list[str] = field(default_factory=list)
    children: list[str] = field(default_factory=list)


@dataclass
class AreaIn:
    area: list[int]  # [x1, y1, x2, y2] в пикселях оригинала
    tag: str  # id тега или фото, на который ведёт зона


@dataclass
class PhotoIn:
    title: str
    info: str = ""
    parents: list[str] = field(default_factory=list)
    areas: list[AreaIn] = field(default_factory=list)


def from_json(cls, data, where: str = ""):
    """Собирает dataclass из разобранного JSON, проверяя типы полей."""
    if not isinstance(data, dict):
        raise HTTPException(422, f"{where or 'тело запроса'}: ожидался объект")
    kwargs = {}
    for f in fields(cls):
        name = f"{where}.{f.name}" if where else f.name
        if f.name in data:
            kwargs[f.name] = convert(f.type, data[f.name], name)
        elif f.default is MISSING and f.default_factory is MISSING:
            raise HTTPException(422, f"{name}: обязательное поле")
    return cls(**kwargs)


def convert(tp, value, name: str):
    if is_dataclass(tp):
        return from_json(tp, value, name)
    if get_origin(tp) is list:
        if not isinstance(value, list):
            raise HTTPException(422, f"{name}: ожидался список")
        (item_tp,) = get_args(tp)
        return [convert(item_tp, v, f"{name}[{n}]") for n, v in enumerate(value)]
    if not isinstance(value, tp) or (tp is int and isinstance(value, bool)):
        raise HTTPException(422, f"{name}: ожидается {'строка' if tp is str else 'целое число'}")
    return value


# --- маршруты --------------------------------------------------------------------

ROUTES: list[tuple[str, re.Pattern, object, int]] = []


def route(method: str, pattern: str, status: int = 200):
    """Регистрирует обработчик; именованные группы pattern передаются в него аргументами."""
    def decorator(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn, status))
        return fn
    return decorator


class File(NamedTuple):
    path: Path
    no_cache: bool = True


class Redirect(NamedTuple):
    location: str


# --- чтение / запись файлов album/json ---------------------------------------

def item_path(item_id: str) -> Path:
    if not ID_RE.match(item_id):
        raise HTTPException(400, f"некорректный id: {item_id}")
    return JSON_DIR / f"{item_id}.js"


def read_item(item_id: str) -> dict:
    path = item_path(item_id)
    if not path.exists():
        raise HTTPException(404, f"{item_id} не найден")
    text = path.read_text(encoding="utf-8")
    match = re.search(r"return\s+(\{.*\})\s*;?\s*\}\s*$", text, re.S)
    if not match:
        raise HTTPException(500, f"не удалось разобрать {path.name}")
    return ast.literal_eval(match.group(1))


def write_item(item_id: str, data: dict) -> None:
    ordered = {k: data[k] for k in KEY_ORDER if k in data}
    ordered.update({k: v for k, v in data.items() if k not in ordered})
    content = f"function set_{item_id}(){{\n  return {ordered!r};\n}}\n"
    path = item_path(item_id)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def all_items() -> dict[str, dict]:
    return {p.stem: read_item(p.stem) for p in sorted(JSON_DIR.glob("*.js"))}


def new_id() -> str:
    return uuid.uuid4().hex


# --- связи parents/children ----------------------------------------------------

def validate(tag_id: str, tag: TagIn, items: dict[str, dict]) -> None:
    if not tag.title.strip():
        raise HTTPException(400, "название не может быть пустым")
    for field in ("parents", "children"):
        values = getattr(tag, field)
        if len(set(values)) != len(values):
            raise HTTPException(400, f"{field}: повторяющиеся id")
        for ref in values:
            if ref == tag_id:
                raise HTTPException(400, f"{field}: тег не может ссылаться сам на себя")
            if ref not in items:
                raise HTTPException(400, f"{field}: {ref} не существует")
    for ref in tag.parents:
        if items[ref]["type"] != "tag":
            raise HTTPException(400, f"родителем может быть только тег, {ref} — фото")
    both = set(tag.parents) & set(tag.children)
    if both:
        raise HTTPException(400, f"id одновременно в родителях и детях: {', '.join(sorted(both))}")


def validate_photo(photo_id: str, photo: PhotoIn, items: dict[str, dict]) -> None:
    if not photo.title.strip():
        raise HTTPException(400, "название не может быть пустым")
    if len(set(photo.parents)) != len(photo.parents):
        raise HTTPException(400, "parents: повторяющиеся id")
    for ref in photo.parents:
        if ref not in items:
            raise HTTPException(400, f"parents: {ref} не существует")
        if items[ref]["type"] != "tag":
            raise HTTPException(400, f"родителем может быть только тег, {ref} — фото")
    for n, a in enumerate(photo.areas, 1):
        # зона ведёт на тег или другое фото
        if a.tag not in items or a.tag == photo_id:
            raise HTTPException(400, f"зона {n}: {a.tag} не существует или это само фото")
        if len(a.area) != 4 or min(a.area) < 0 or a.area[0] >= a.area[2] or a.area[1] >= a.area[3]:
            raise HTTPException(400, f"зона {n}: некорректные координаты {a.area}")


def sync_links(tag_id: str, old: dict, new: dict, items: dict[str, dict]) -> set[str]:
    """Поддерживает обратные ссылки: мои родители держат меня в children, дети — в parents."""
    changed = set()
    for field, back in (("parents", "children"), ("children", "parents")):
        old_refs, new_refs = set(old.get(field, [])), set(new.get(field, []))
        for ref in new_refs - old_refs:
            lst = items[ref].setdefault(back, [])
            if tag_id not in lst:
                lst.append(tag_id)
                changed.add(ref)
        for ref in old_refs - new_refs:
            if ref in items and tag_id in items[ref].get(back, []):
                items[ref][back].remove(tag_id)
                changed.add(ref)
    return changed


def unlink_item(item_id: str, items: dict[str, dict]) -> set[str]:
    """Убирает все ссылки на удаляемый элемент из остальных: parents/children, зоны на фото
    и ссылки [текст|id] в info (от ссылки остаётся её текст). Возвращает id изменённых элементов."""
    link_re = re.compile(r"\[([^\]|]+)\|" + re.escape(item_id) + r"\]")
    changed = set()
    for ref, d in items.items():
        if ref == item_id:
            continue
        for field in ("parents", "children"):
            if item_id in d.get(field, []):
                d[field] = [x for x in d[field] if x != item_id]
                changed.add(ref)
        if any(a.get("tag") == item_id for a in d.get("areas", [])):
            d["areas"] = [a for a in d["areas"] if a.get("tag") != item_id]
            changed.add(ref)
        if link_re.search(d.get("info", "")):
            d["info"] = link_re.sub(r"\1", d["info"])
            changed.add(ref)
    return changed


def get_typed(item_id: str, kind: str, items: dict[str, dict]) -> dict:
    if item_id not in items:
        raise HTTPException(404, f"{item_id} не найден")
    if items[item_id]["type"] != kind:
        raise HTTPException(400, f"{item_id} — не {'тег' if kind == 'tag' else 'фото'}")
    return items[item_id]


def get_tag(item_id: str, items: dict[str, dict]) -> dict:
    return get_typed(item_id, "tag", items)


# --- API -------------------------------------------------------------------------

@route("GET", "/api/items")
def list_items(req):
    """Все элементы (теги и фото) кратко — для списков выбора родителей/детей."""
    return [
        {"id": i, "type": d["type"], "title": d["title"], "parents": d.get("parents", [])}
        for i, d in all_items().items()
    ]


@route("GET", "/api/tags")
def list_tags(req):
    return [{"id": i, **d} for i, d in all_items().items() if d["type"] == "tag"]


@route("GET", "/api/tags/(?P<tag_id>[^/]+)")
def get_tag_api(req, tag_id: str):
    return {"id": tag_id, **get_tag(tag_id, all_items())}


@route("POST", "/api/tags", status=201)
def create_tag(req):
    tag = req.json(TagIn)
    with DATA_LOCK:
        items = all_items()
        tag_id = new_id()
        validate(tag_id, tag, items)
        data = {"type": "tag", **asdict(tag)}
        changed = sync_links(tag_id, {}, data, items)
        write_item(tag_id, data)
        for ref in changed:
            write_item(ref, items[ref])
        return {"id": tag_id, **data, "changed": sorted(changed)}


@route("PUT", "/api/tags/(?P<tag_id>[^/]+)")
def update_tag(req, tag_id: str):
    tag = req.json(TagIn)
    with DATA_LOCK:
        items = all_items()
        old = get_tag(tag_id, items)
        validate(tag_id, tag, items)
        data = {**old, **asdict(tag)}
        changed = sync_links(tag_id, old, data, items)
        write_item(tag_id, data)
        for ref in changed:
            write_item(ref, items[ref])
        return {"id": tag_id, **data, "changed": sorted(changed)}


@route("DELETE", "/api/tags/(?P<tag_id>[^/]+)")
def delete_tag(req, tag_id: str):
    with DATA_LOCK:
        items = all_items()
        get_tag(tag_id, items)
        changed = unlink_item(tag_id, items)
        for ref in changed:
            write_item(ref, items[ref])
        item_path(tag_id).unlink()
        return {"id": tag_id, "changed": sorted(changed)}


@route("GET", "/api/photos/(?P<photo_id>[^/]+)")
def get_photo_api(req, photo_id: str):
    return {"id": photo_id, **get_typed(photo_id, "photo", all_items())}


@route("DELETE", "/api/photos/(?P<photo_id>[^/]+)")
def delete_photo(req, photo_id: str):
    with DATA_LOCK:
        items = all_items()
        get_typed(photo_id, "photo", items)
        changed = unlink_item(photo_id, items)
        for ref in changed:
            write_item(ref, items[ref])
        item_path(photo_id).unlink()
        # оригинал (у видео — кадр-обложка), превью и само видео
        for path in (IMGS_DIR / f"{photo_id}.jpg", ICONS_DIR / f"{photo_id}.jpg", VIDEOS_DIR / f"{photo_id}.mp4"):
            path.unlink(missing_ok=True)
        return {"id": photo_id, "changed": sorted(changed)}


def make_icon(img: Image.Image, photo_id: str) -> None:
    icon = ImageOps.exif_transpose(img).convert("RGB")
    icon.thumbnail((ICON_HEIGHT * 10, ICON_HEIGHT))
    icon.save(ICONS_DIR / f"{photo_id}.jpg", quality=90)


def open_image(path: Path) -> Image.Image | None:
    try:
        img = Image.open(path)
        img.load()
        return img
    except (UnidentifiedImageError, OSError):
        return None


def save_images(photo_id: str, src: Path, img: Image.Image) -> None:
    """Оригинал в imgs/<id>.jpg (JPEG — как есть, с EXIF), превью в icons/<id>.jpg."""
    if img.format == "JPEG":
        shutil.copyfile(src, IMGS_DIR / f"{photo_id}.jpg")
    else:
        ImageOps.exif_transpose(img).convert("RGB").save(IMGS_DIR / f"{photo_id}.jpg", quality=92)
    make_icon(img, photo_id)


def probe_video(path: Path) -> dict | None:
    """Потоки и длительность по ffprobe; None — если в файле нет видеопотока."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    info = json.loads(result.stdout)
    streams = info.get("streams", [])
    video = next((st for st in streams if st.get("codec_type") == "video"), None)
    # картинки ffprobe тоже видит как видео из одного кадра, но их раньше открывает Pillow
    if not video:
        return None
    audio = next((st for st in streams if st.get("codec_type") == "audio"), None)
    return {
        "video": video.get("codec_name"),
        "pix_fmt": video.get("pix_fmt"),
        "audio": audio and audio.get("codec_name"),
        "duration": float(info.get("format", {}).get("duration") or 0),
    }


def run_ffmpeg(args: list[str]) -> None:
    result = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(400, f"не удалось обработать видео: {result.stderr.strip()[-300:]}")


def save_video(photo_id: str, src: Path, probe: dict) -> None:
    """Видео в videos/<id>.mp4 (H.264/AAC — играет во всех браузерах), кадр-обложка в imgs/<id>.jpg, превью в icons/<id>.jpg."""
    VIDEOS_DIR.mkdir(exist_ok=True)
    out = VIDEOS_DIR / f"{photo_id}.mp4"
    poster = IMGS_DIR / f"{photo_id}.jpg"
    tmp = out.with_suffix(".tmp")
    # подходящие потоки только перекладываем в mp4, остальное перекодируем
    if probe["video"] == "h264" and probe["pix_fmt"] == "yuv420p":
        video_args = ["-c:v", "copy"]
    else:
        video_args = ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p"]
    if not probe["audio"]:
        audio_args = ["-an"]
    elif probe["audio"] in ("aac", "mp3"):
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", "aac", "-b:a", "160k"]
    try:
        run_ffmpeg(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", *video_args, *audio_args,
                    "-movflags", "+faststart", "-f", "mp4", str(tmp)])
        os.replace(tmp, out)
        # обложка — кадр с первой секунды (или из середины совсем короткого видео)
        run_ffmpeg(["-ss", str(min(1.0, probe["duration"] / 2)), "-i", str(out), "-frames:v", "1", str(poster)])
        img = open_image(poster)
        if img is None:
            raise HTTPException(400, "не удалось получить кадр-обложку видео")
        make_icon(img, photo_id)
    except HTTPException:
        for path in (tmp, out, poster):
            path.unlink(missing_ok=True)
        raise


@route("POST", "/api/photos", status=201)
def create_photo(req):
    # файл из формы уже лежит во временном файле (ffmpeg нужен путь); его sha256 — это id
    form, files = req.multipart(ALBUM_DIR)
    try:
        src = files.get("file")
        if src is None or "title" not in form:
            raise HTTPException(422, "в форме нужны поля file и title")
        try:
            parents = json.loads(form.get("parents", "[]"))  # JSON-список id тегов
        except ValueError:
            raise HTTPException(400, "parents: некорректный список")
        photo = from_json(PhotoIn, {"title": form["title"].strip(), "info": form.get("info", ""), "parents": parents})
        with src.open("rb") as f:
            photo_id = hashlib.file_digest(f, "sha256").hexdigest()

        def check(items):
            if photo_id in items:
                raise HTTPException(409, {"message": f"этот файл уже есть в альбоме: «{items[photo_id]['title']}»", "id": photo_id})
            validate_photo(photo_id, photo, items)

        check(all_items())
        data = {"type": "photo", "title": photo.title, "info": photo.info, "parents": photo.parents,
                "children": [], "areas": []}
        # перекодирование видео долгое — идёт вне блокировки, другие запросы не ждут
        img = open_image(src)
        if img is not None:
            save_images(photo_id, src, img)
        else:
            probe = probe_video(src)
            if probe is None:
                raise HTTPException(400, "файл не является изображением или видео")
            save_video(photo_id, src, probe)
            data["media"] = "video"
    finally:
        for path in files.values():
            path.unlink(missing_ok=True)
    with DATA_LOCK:
        # пока обрабатывалось видео, альбом могли изменить — перечитываем и проверяем заново
        items = all_items()
        check(items)
        changed = sync_links(photo_id, {}, data, items)
        write_item(photo_id, data)
        for ref in changed:
            write_item(ref, items[ref])
    return {"id": photo_id, **data, "changed": sorted(changed)}


@route("PUT", "/api/photos/(?P<photo_id>[^/]+)")
def update_photo(req, photo_id: str):
    photo = req.json(PhotoIn)
    with DATA_LOCK:
        items = all_items()
        old = get_typed(photo_id, "photo", items)
        validate_photo(photo_id, photo, items)
        data = {**old, **asdict(photo)}
        # тег, на который ведёт зона, становится родителем фото, а фото — его дочерним (через sync_links);
        # тег, с которого зону убрали и который больше не отмечен ни одной зоной, — перестаёт быть родителем
        new_tags = [a["tag"] for a in data["areas"] if items[a["tag"]]["type"] == "tag"]
        dropped = {a["tag"] for a in old.get("areas", [])} - set(new_tags)
        data["parents"] = [p for p in data["parents"] if p not in dropped]
        for tag in new_tags:
            if tag not in data["parents"]:
                data["parents"].append(tag)
        changed = sync_links(photo_id, old, data, items)
        write_item(photo_id, data)
        for ref in changed:
            write_item(ref, items[ref])
        return {"id": photo_id, **data, "changed": sorted(changed)}


# --- страницы и статика ----------------------------------------------------------

def static_file(base: Path, rel: str, html: bool = False) -> Path:
    """Файл внутри base; выход за его пределы (../) — 404. html=True: для каталога отдаём index.html."""
    base = base.resolve()
    path = (base / rel).resolve()
    if not path.is_relative_to(base):
        raise HTTPException(404, "Not Found")
    if html and path.is_dir():
        path = path / "index.html"
    if not path.is_file():
        raise HTTPException(404, "Not Found")
    return path


# страницы и /static — без кэша, чтобы после правок редактора браузер не показывал старую версию

@route("GET", "/")
def root(req):
    return File(STATIC_DIR / "tags.html")


@route("GET", "/photo/new")
def new_photo_page(req):
    return File(STATIC_DIR / "upload.html")


@route("GET", "/photo/(?P<photo_id>[^/]+)")
def photo_page(req, photo_id: str):
    return File(STATIC_DIR / "photo.html")


@route("GET", "/static/(?P<rel>.*)")
def static(req, rel: str):
    return File(static_file(STATIC_DIR, rel))


@route("GET", "/favicon.ico")
def favicon(req):
    # браузеры запрашивают /favicon.ico сами, в том числе для страниц альбома
    return File(STATIC_DIR / "favicon.ico", no_cache=False)


@route("GET", "/album")
def album_root(req):
    # относительные ссылки index.html работают только со слешем на конце
    return Redirect("/album/")


@route("GET", "/album/(?P<rel>.*)")
def album(req, rel: str):
    return File(static_file(ALBUM_DIR, rel, html=True), no_cache=False)


# --- HTTP-сервер -----------------------------------------------------------------

MAX_FIELD = 1 << 20  # предел для JSON-тела, текстового поля формы и заголовков части


class BodyReader:
    """Потоковое чтение тела запроса ровно в Content-Length байт."""

    def __init__(self, rfile, length: int):
        self.rfile, self.left, self.buf = rfile, length, b""

    def fill(self) -> None:
        chunk = self.rfile.read(min(1 << 20, self.left)) if self.left else b""
        if not chunk:
            raise HTTPException(400, "тело запроса оборвалось")
        self.left -= len(chunk)
        self.buf += chunk

    def take(self, n: int) -> bytes:
        while len(self.buf) < n:
            self.fill()
        data, self.buf = self.buf[:n], self.buf[n:]
        return data

    def read_until(self, sep: bytes, out=None, limit: int = MAX_FIELD) -> bytes:
        """Читает до разделителя sep и съедает его. С out — пишет данные туда, иначе возвращает (не больше limit)."""
        parts, size = [], 0
        while True:
            idx = self.buf.find(sep)
            if idx >= 0:
                data, self.buf = self.buf[:idx], self.buf[idx + len(sep):]
            else:
                # хвост буфера может оказаться началом разделителя — оставляем его
                keep = len(sep) - 1
                data, self.buf = self.buf[:-keep] if keep else self.buf, self.buf[-keep:] if keep else b""
            if out is not None:
                out.write(data)
            else:
                size += len(data)
                if size > limit:
                    raise HTTPException(413, "слишком большое поле запроса")
                parts.append(data)
            if idx >= 0:
                return b"".join(parts)
            self.fill()


def header_params(value: str) -> Message:
    msg = Message()
    msg["x"] = value
    return msg


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "photo_album"

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET", head=True)

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # --- тело запроса

    def body_reader(self) -> BodyReader:
        length = self.headers.get("Content-Length")
        if length is None or not length.isdigit():
            raise HTTPException(411, "нужен заголовок Content-Length")
        self.body = BodyReader(self.rfile, int(length))
        return self.body

    def json(self, cls):
        reader = self.body_reader()
        if reader.left > MAX_FIELD:
            raise HTTPException(413, "слишком большое тело запроса")
        try:
            data = json.loads(reader.take(reader.left))
        except ValueError:
            raise HTTPException(422, "тело запроса — не JSON")
        return from_json(cls, data)

    def multipart(self, tmp_dir: Path) -> tuple[dict[str, str], dict[str, Path]]:
        """Разбирает multipart/form-data: текстовые поля — в строки, файлы — во временные файлы в tmp_dir."""
        boundary = header_params(self.headers.get("Content-Type", "")).get_param("boundary", header="x")
        if not boundary or self.headers.get_content_type() != "multipart/form-data":
            raise HTTPException(400, "ожидалась форма multipart/form-data")
        reader = self.body_reader()
        delim = b"\r\n--" + boundary.encode()
        form, files = {}, {}
        try:
            reader.read_until(delim[2:])  # преамбула
            while reader.take(2) == b"\r\n":
                headers = HeaderParser().parsestr(reader.read_until(b"\r\n\r\n").decode("utf-8", "replace"))
                name = headers.get_param("name", header="content-disposition")
                if headers.get_filename() is not None:
                    with tempfile.NamedTemporaryFile(dir=tmp_dir, suffix=".upload", delete=False) as tmp:
                        files[name] = Path(tmp.name)
                        reader.read_until(delim, out=tmp)
                else:
                    form[name] = reader.read_until(delim).decode("utf-8", "replace")
        except BaseException:
            for path in files.values():
                path.unlink(missing_ok=True)
            raise
        return form, files

    # --- ответы

    def send_json(self, status: int, data) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not self.head:
            self.wfile.write(body)

    def send_redirect(self, location: str) -> None:
        self.send_response(307)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_file(self, file: File) -> None:
        st = file.path.stat()
        size = st.st_size
        ctype = mimetypes.guess_type(file.path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/"):
            ctype += "; charset=utf-8"
        headers = {"Content-Type": ctype, "Accept-Ranges": "bytes",
                   "Last-Modified": formatdate(st.st_mtime, usegmt=True)}
        if file.no_cache:
            headers["Cache-Control"] = "no-cache"

        # Range нужен видео: без него браузер не перематывает, а Safari вовсе не играет
        start, end, status = 0, size - 1, 200
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if m and (m[1] or m[2]):
            if m[1]:
                start = int(m[1])
                end = min(int(m[2]), size - 1) if m[2] else size - 1
            else:
                start = max(size - int(m[2]), 0)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        elif self.not_modified(st.st_mtime):
            self.send_response(304)
            for key in ("Last-Modified", "Cache-Control"):
                if key in headers:
                    self.send_header(key, headers[key])
            self.end_headers()
            return

        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        if self.head:
            return
        with file.path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def not_modified(self, mtime: float) -> bool:
        since = self.headers.get("If-Modified-Since")
        if not since:
            return False
        try:
            return int(mtime) <= parsedate_to_datetime(since).timestamp()
        except (TypeError, ValueError):
            return False

    # --- разбор маршрута

    def dispatch(self, method: str, head: bool = False) -> None:
        self.head = head
        self.body = None
        path = unquote(urlsplit(self.path).path)
        try:
            for route_method, pattern, handler, status in ROUTES:
                m = pattern.match(path)
                if m and route_method == method:
                    result = handler(self, **m.groupdict())
                    break
            else:
                known = any(pattern.match(path) for _, pattern, _, _ in ROUTES)
                raise HTTPException(405 if known else 404, "Method Not Allowed" if known else "Not Found")
            if isinstance(result, File):
                self.send_file(result)
            elif isinstance(result, Redirect):
                self.send_redirect(result.location)
            else:
                self.send_json(status, result)
        except (BrokenPipeError, ConnectionResetError):
            # клиент ушёл, не дочитав ответ (например, видео перемотали) — это нормально
            self.close_connection = True
        except Exception as e:
            if isinstance(e, HTTPException):
                status, detail = e.status_code, e.detail
            else:
                traceback.print_exc()
                status, detail = 500, "внутренняя ошибка сервера"
            # недочитанное тело осталось в сокете — соединение дальше не использовать
            if self.headers.get("Content-Length", "0") != "0" and (self.body is None or self.body.left):
                self.close_connection = True
            self.send_json(status, {"detail": detail})


def code_mtimes() -> dict[Path, float]:
    mtimes = {}
    for path in BASE_DIR.glob("*.py"):
        try:
            mtimes[path] = path.stat().st_mtime
        except FileNotFoundError:  # редактор мог сохранять файл через удаление и переименование
            pass
    return mtimes


def run_with_reload(argv: list[str]) -> None:
    """Запускает сервер дочерним процессом и перезапускает его при изменении .py в server/.
    Если новый код упал при запуске, ждём следующего изменения, а не выходим."""
    cmd = [sys.executable, str(Path(__file__).resolve()), *[a for a in argv if a != "--reload"]]
    while True:
        seen = code_mtimes()
        child = subprocess.Popen(cmd)
        try:
            while code_mtimes() == seen:
                time.sleep(0.5)
        except KeyboardInterrupt:
            # Ctrl+C получил и дочерний процесс — даём ему завершиться самому
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
            return
        print("код изменён — перезапуск сервера", flush=True)
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def main() -> None:
    parser = argparse.ArgumentParser(description="редактор фотоальбома")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="перезапускать сервер при изменении кода в server/")
    args = parser.parse_args()
    if args.reload:
        run_with_reload(sys.argv[1:])
        return
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
