import io
import os
import collections
import hashlib
import dataclasses

from PIL import Image

from .util import StrEnum


class AssetTypes(StrEnum):
    GFX = "gfx"
    SFX = "sfx"
    MUSIC = "music"
    TILEMAP = "tilemap"


ASSET_PATH = os.path.join(os.path.dirname(__file__), "..", "data")
TILES_PATH = os.path.join(ASSET_PATH, "gfx", "tiles.png")

MUSIC_PATH = os.path.join(ASSET_PATH, "music")
MUSIC = os.listdir(MUSIC_PATH)


class TerrainMap(StrEnum):
    PLAYER = "gold"
    GRASS = "green"
    WATER = "blue"
    SAND = "yellow"
    MOUNTAINS = "grey"
    DOOR = "purple"
    FLOOR = "lightgrey"
    WALL = "dimgrey"


TILEMAP = collections.OrderedDict((
    ("player", ((0, 3), TerrainMap.PLAYER)),
    ("orc1", ((14, 13), None)),
    ("grass1", ((9, 23), TerrainMap.GRASS)),
    ("grass2", ((10, 23), TerrainMap.GRASS)),
    ("grass3", ((11, 23), TerrainMap.GRASS)),
    ("water1", ((15, 23), TerrainMap.WATER)),
    ("water2", ((16, 23), TerrainMap.WATER)),
    ("water3", ((17, 23), TerrainMap.WATER)),
    ("sand1", ((12, 23), TerrainMap.SAND)),
    ("sand2", ((13, 23), TerrainMap.SAND)),
    ("sand3", ((14, 23), TerrainMap.SAND)),
    ("mountains1", ((117, 23), TerrainMap.MOUNTAINS)),
    ("mountains2", ((118, 23), TerrainMap.MOUNTAINS)),
    ("mountains3", ((119, 23), TerrainMap.MOUNTAINS)),
    ("crypt1", ((7, 22), TerrainMap.DOOR)),
    ("crypt2", ((13, 22), TerrainMap.DOOR)),
    ("crypt3", ((14, 22), TerrainMap.DOOR)),
    ("stairsdown1", ((3, 24), TerrainMap.DOOR)),
    ("stairsup1", ((0, 24), TerrainMap.DOOR)),
    ("grey3", ((8, 24), TerrainMap.FLOOR)),
    ("wall3", ((2, 22), TerrainMap.WALL)),
    ("coin1", ((7, 7), None)),
    ("coin2", ((8, 7), None)),
    ("coin3", ((9, 7), None)),
    ("coin4", ((10, 7), None)),
    ("coin5", ((11, 7), None)),
    ("sword1", ((8, 10), None)),
    ("shield1", ((100, 0), None)),
    ("potion1", ((28, 8), None)),
))


class TileSet(object):
    def __init__(self, tilemap, tilesize):
        self.tilemap = tilemap  # XXX build a map of rects
        self.index_map = {k: i for i, k in enumerate(self.tilemap)}
        self.tilesize = tilesize
        self.tiles = Image.open(TILES_PATH)
        self.tile_cache = {}
        self.indexed_map = list(self.tilemap.values())

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


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight


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

