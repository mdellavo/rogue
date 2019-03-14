import io
import os
import collections
import hashlib
import dataclasses

from PIL import Image

ASSET_TYPES = ("gfx", "sfx", "music")  # XXX enum
ASSET_PATH = os.path.join(os.path.dirname(__file__), "..", "data")
TILES_PATH = os.path.join(ASSET_PATH, "gfx", "tiles.png")

MUSIC_PATH = os.path.join(ASSET_PATH, "music")
MUSIC = os.listdir(MUSIC_PATH)

TILEMAP = collections.OrderedDict((
    ("player", (0, 3)),
    ("orc1", (14, 13)),
    ("grass1", (9, 23)),
    ("grass2", (10, 23)),
    ("grass3", (11, 23)),
    ("water1", (15, 23)),
    ("water2", (16, 23)),
    ("water3", (17, 23)),
    ("sand1", (12, 23)),
    ("sand2", (13, 23)),
    ("sand3", (14, 23)),
    ("mountains1", (117, 23)),
    ("mountains2", (118, 23)),
    ("mountains3", (119, 23)),
    ("crypt1", (7, 22)),
    ("stairsdown1", (3, 24)),
    ("stairsup1", (0, 24)),
    ("grey3", (8, 24)),
    ("wall3", (2, 22)),
    ("coin1", (7, 7)),
    ("coin2", (8, 7)),
    ("coin3", (9, 7)),
    ("coin4", (10, 7)),
    ("coin5", (11, 7)),
    ("sword1", (8, 10)),
    ("shield1", (100, 0)),
    ("potion1", (28, 8)),
    ("crypt2", (13, 22)),
))


class TileSet(object):
    def __init__(self, tilemap, tilesize):
        self.tilemap = tilemap  # XXX build a map of rects
        self.index_map = {k: i for i, k in enumerate(self.tilemap)}
        self.tilesize = tilesize
        self.tiles = Image.open(TILES_PATH)
        self.tile_cache = {}

    @property
    def num_tiles(self):
        return len(self.tilemap)

    def bounding(self, x, y):
        l = x * self.tilesize
        t = y * self.tilesize
        r = (l, t, l + self.tilesize, t + self.tilesize)
        return r

    def get_tile_by_index(self, idx):
        key = list(self.tilemap.keys())[idx]
        return self.tilemap[key]

    def get_index(self, key):
        return self.index_map[key]

    def get_tile_bitmap(self, idx):
        rv = self.tile_cache.get(idx)
        if not rv:
            x, y = self.get_tile_by_index(idx)
            box = self.bounding(x, y)
            cropped = self.tiles.crop(box)
            out = io.BytesIO()
            cropped.save(out, format="PNG")
            img_bytes = out.getvalue()
            digest = hashlib.sha1(img_bytes).hexdigest()
            rv = (digest, img_bytes)
            self.tile_cache[idx] = rv
        return rv

    def get_indexed_map(self):

        def _tile(k):
            return {
                "key": k,
                "coords": self.tilemap[k]
            }

        return [_tile(k) for k in self.tilemap.keys()]


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight
        self.explored = False


@dataclasses.dataclass
class Door(Tile):
    def __init__(self, key, area=None, position=None, message="a door", **kwargs):
        super(Door, self).__init__(key, **kwargs)
        self.area = area
        self.position = position
        self.message = kwargs.pop("message", message)

    def __str__(self):
        return self.message

    def get_area(self, world, exit_area, exit_position):
        if not self.area:
            return ValueError("door needs area")
        return self.area, self.position

