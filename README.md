# Photo Album

A personal photo and video album organised as a graph of tags, plus a small local web editor for maintaining it.

The project has two independent parts:

- **`album/`** — the album itself: a static site with no build step and no backend. Open `album/index.html` straight from disk (`file://`) or serve the folder with any static web server.
- **`server/`** — a local editor: a single-file Python HTTP server that creates tags, uploads photos and videos, marks zones on photos and writes everything back into `album/`.

The album's user interface is in Russian.

## Contents

- [How the album is organised](#how-the-album-is-organised)
- [Viewing the album](#viewing-the-album)
- [Running the editor](#running-the-editor)
- [Using the editor](#using-the-editor)
- [Data format](#data-format)
- [HTTP API](#http-api)
- [Project layout](#project-layout)
- [Implementation notes](#implementation-notes)
- [License](#license)

## How the album is organised

Everything in the album is an **item**. There are two kinds:

- **Tags** group other items, for example "years", "places", "people", "2015" or "Paris". A tag can have several parents and several children, so tags form a graph rather than a strict tree.
- **Photos** are single images or videos. A photo belongs to one or more parent tags, and it can carry **zones**: rectangles on the image that link to a tag or to another photo (for example, a person's face linking to that person's tag).

The root of the graph is the tag **"Главная страница"** (home page) with id `00000000000000000000000000000000`. The album opens on this tag.

Links are kept symmetric: when a photo or tag lists a parent, the parent lists it among its children. A zone that points to a tag also makes that tag a parent of the photo.

Item descriptions (the "Информация" field) can contain inline links written as `[link text|item id]`. The album renders them as links to that item's page.

## Viewing the album

The album needs no server:

```sh
xdg-open album/index.html          # or open the file in any browser
```

You can also serve it over HTTP:

```sh
python3 -m http.server --directory album
# http://127.0.0.1:8000/index.html
```

The editor also serves the album at `/album/` (see below).

What the album shows:

- **Tag page:**
  - a breadcrumb path to the root;
  - the tag's description;
  - its parent and child tags;
  - thumbnails of all photos and videos found under the tag's children. How deep the album looks for them is set by `settings.icons` in `album/js/main.js`.
- **Photo page:**
  - the full-size image, with its zones drawn over it and labelled;
  - `<` / `>` buttons, or the **←** / **→** keys, to move to the neighbouring photo of the tag you came from.
- **Video page:** an HTML5 player with a poster frame instead of the image. Zones are not used on videos.

## Running the editor

### Requirements

- Python **3.11+** (developed on 3.12).
- [Pillow](https://python-pillow.org/), listed in `requirements.txt`.
- **ffmpeg** and **ffprobe** on `PATH`. They are needed only for uploading videos (for example, `sudo apt install ffmpeg`).

The server uses only the Python standard library (`http.server`) apart from Pillow.

### Setup

The virtual environment lives in the project root (`bin/`, `lib/` and `pyvenv.cfg` are git-ignored):

```sh
python3 -m venv .
bin/pip install -r requirements.txt
```

### Start

```sh
bin/python server/main.py --port 8000 --reload
```

Then open <http://127.0.0.1:8000/>.

| Option | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Address to listen on. |
| `--port` | `8000` | Port to listen on. |
| `--reload` | off | Restart the server whenever a `.py` file in `server/` changes. If the new code fails to start, the watcher keeps running and retries after the next change. |

Files in `server/static/` are served with `Cache-Control: no-cache`, so HTML, CSS and JS edits only need a page refresh, not a restart.

> **The editor has no authentication.** Anyone who can reach it can edit and delete the album. Keep it bound to `127.0.0.1` and do not expose it to a network.

## Using the editor

### Tags page (`/`)

- The left column lists the **root tags**, meaning tags that have no parents. Click a tag, or use **↑** / **↓** while no input field is focused, to open it for editing. The selected tag is highlighted.
- The form has the tag's title, its description, its parent tags (only tags are allowed) and its children (tags or photos).
- **Сохранить** saves the tag, and **Удалить** deletes it. Deleting a tag removes every reference to it: from parents and children, from zones on photos, and from `[text|id]` links in descriptions. A link to a deleted item keeps its text and loses only the link.
- If the form has unsaved changes, switching to another tag, creating a new one or leaving for the upload page asks for confirmation first.

### Upload page (`/photo/new`)

- Pick an image or a video and give it a title, a description and parent tags.
- **Images:** any format Pillow can read is accepted. JPEG files are stored as they are, with their EXIF data kept. Other formats are converted to JPEG, with the EXIF orientation applied.
- **Videos:** the file is remuxed into MP4 when it is already H.264/yuv420p with AAC or MP3 audio. Otherwise it is transcoded to H.264/AAC, so that it plays in every browser. A poster frame is taken about one second into the video.
- A 100 px high thumbnail is generated for every photo and video.
- The item id is the SHA-256 of the uploaded file, so the same file cannot be added twice. Uploading a duplicate offers to open the existing item.
- A progress indicator is shown while large files upload. After a successful upload the photo editor opens.

### Photo page (`/photo/<id>`)

- Edit the title, the description and the parent tags. **Удалить** deletes the photo or video.
- **Working with zones** (photos only):
  - drag on the photo to draw a new zone;
  - drag a zone to move it;
  - drag a zone's edge or corner to resize it;
  - use **⬚** to draw a new frame for an existing zone.
- Each zone must point to a tag or to another photo. A zone that points to a tag adds that tag to the photo's parents. When the last zone pointing to a tag is removed, that tag is removed from the parents again.
- **Deleting a photo or video removes:**
  - its JSON file;
  - its image (for a video, the poster frame);
  - its thumbnail;
  - its video file;
  - every reference to it, from tags' children, from zones on other photos and from links in descriptions.

### Drop-down pickers

The pickers for parents, children, description links and zone targets all work the same way:

- Type to search. Items are matched by their full path ("Главная страница | места | Россия"), and matches in the title are listed before matches elsewhere in the path. Photos are shown in a different colour.
- **↑** / **↓** move the highlight through the list.
- **Space** selects the highlighted item. In the parent and child pickers it ticks the item instead, so several items can be added at once with the **Добавить (N)** button.
- **Enter** adds the ticked items, or the highlighted item (the first match if nothing is highlighted).
- **Esc** or a click outside closes the picker without adding anything.

To insert a description link, select some text in the description and pick an item. The selected text becomes the link text. With no selection, the item's title is inserted.

## Data format

All album data lives in `album/`. The folders below are git-ignored: they are the personal content of the album, not part of the code.

| Path | Content |
| --- | --- |
| `album/json/<id>.js` | One file per item (tag or photo). |
| `album/imgs/<id>.jpg` | The full-size photo, or the poster frame of a video. |
| `album/icons/<id>.jpg` | The 100 px high thumbnail. |
| `album/videos/<id>.mp4` | The video file (videos only). |

### Ids

- **Tags:** a UUID4 written as 32 hex characters without dashes. The root tag is 32 zeros.
- **Photos and videos:** the SHA-256 of the original upload, 64 hex characters.

### Item files

Items are stored as JavaScript rather than JSON, so the album can load them with `<script>` tags even from `file://`, where browsers block `fetch`. Each file defines a function named `set_<id>` that returns the item:

```js
function set_00000000000000000000000000000000(){
  return {'type': 'tag', 'title': 'Главная страница', 'parents': [], 'children': ['5e79fe6c388c4f7da815f39783a7d927'], 'info': 'Главная страница'};
}
```

The fields are:

| Field | Items | Meaning |
| --- | --- | --- |
| `type` | all | `"tag"` or `"photo"` (videos are photos too). |
| `media` | videos | `"video"`; absent for images. |
| `title` | all | Display title. |
| `parents` | all | Ids of parent tags. |
| `children` | all | Ids of child tags and photos (always empty for photos). |
| `info` | all | Description; may contain `[text|id]` links. |
| `areas` | photos | Zones: `[{"area": [x1, y1, x2, y2], "tag": "<id>"}]`, with coordinates in pixels of the original image. |

The editor writes these files atomically (to a temporary file, then renamed into place) with a stable key order. It parses them with `ast.literal_eval`, so they must stay plain literals.

## HTTP API

The editor's pages use a JSON API. Errors come back as `{"detail": "..."}` with a matching status code (400, 404, 409, 422, ...).

| Method and path | Purpose |
| --- | --- |
| `GET /api/items` | All items in short form (`id`, `type`, `title`, `parents`), used by the pickers. |
| `GET /api/tags` | All tags with full data. |
| `GET /api/tags/<id>` | One tag. |
| `POST /api/tags` | Create a tag from `{title, info?, parents?, children?}`. |
| `PUT /api/tags/<id>` | Update a tag, with the same body as `POST`. |
| `DELETE /api/tags/<id>` | Delete a tag and every reference to it. |
| `GET /api/photos/<id>` | One photo or video. |
| `POST /api/photos` | Upload a photo or video as `multipart/form-data` with the fields `file`, `title`, `info` and `parents` (a JSON list of tag ids). |
| `PUT /api/photos/<id>` | Update a photo from `{title, info?, parents?, areas?}`. |
| `DELETE /api/photos/<id>` | Delete a photo or video, its files and every reference to it. |

Changing an item also updates the items linked to it. Responses list the ids of those items in `changed`.

The server also serves these paths:

- `/` — the tags page;
- `/photo/new` — the upload page;
- `/photo/<id>` — the photo page;
- `/static/...` — the editor's own files;
- `/album/...` — the album. Range requests are supported so that videos can be seeked.

## Project layout

```
album/                  the static album
  index.html            empty page; everything is built by the scripts
  css/main.css
  js/main.js            settings, page loading, layout helpers, ← / → navigation
  js/tags.js            parent/child tag lists and thumbnail collection
  js/media.js           photo/video view, zones, prev/next buttons, thumbnails
  js/info.js            breadcrumb path and description rendering ([text|id] links)
  json/ imgs/ icons/ videos/   album content (git-ignored)
server/
  main.py               the editor: HTTP server, API, validation, media processing
  static/
    tags.html           tags page
    photo.html          photo/video page with the zone editor
    upload.html         upload page
    common.js           shared helpers: API calls, pickers, item paths
    common.css          shared styles
requirements.txt
```

## Implementation notes

- **Server.** `server/main.py` runs on `http.server.ThreadingHTTPServer`, with a small regex-based router, dataclass request models with type checking, a streaming `multipart/form-data` parser (uploads go straight to a temporary file) and static file serving with `Range`, `Last-Modified` and `304` support.
- **Concurrency.** Requests run in threads. Every read-modify-write of `album/json` happens under one lock. Video transcoding runs outside the lock, and the album is re-read and re-validated before the new item is written.
- **Validation.**
  - Titles must not be empty.
  - Links must point to existing items.
  - Only tags can be parents.
  - An item cannot be its own parent, child or zone target.
  - An item cannot be both a parent and a child of the same tag.
  - Zone rectangles must be well-formed.
- **Album loading.** The album loads item files on demand, one `<script>` per item, and walks the graph to collect thumbnails. It guards against cycles and duplicates, and drops responses that arrive after you have already moved to another page.

## License

The code is released under the [MIT License](LICENSE). The album content (photos, videos and item data in `album/json`, `album/imgs`, `album/icons` and `album/videos`) is not part of the repository and is not covered by this license.
