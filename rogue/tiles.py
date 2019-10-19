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


class TerrainTypes(StrEnum):
    PLAYER = "player"
    GRASS = "grass"
    WATER = "water"
    SAND = "sand"
    MOUNTAINS = "mountains"
    DOOR = "door"
    FLOOR = "floor"
    WALL = "wall"


TERRAIN_COLORMAP = {
    TerrainTypes.PLAYER: "gold",
    TerrainTypes.GRASS: "green",
    TerrainTypes.WATER: "blue",
    TerrainTypes.SAND: "yellow",
    TerrainTypes.MOUNTAINS: "grey",
    TerrainTypes.DOOR: "purple",
    TerrainTypes.FLOOR: "lightgrey",
    TerrainTypes.WALL: "dimgrey",
}

class TileSet(object):
    def __init__(self, tilemap, tilesize):
        self.tilemap = tilemap  # XXX build a map of rects
        self.index_map = {k: i for i, k in enumerate(self.tilemap)}
        self.tilesize = tilesize
        self.tile_cache = {}
        self.indexed_map = [
            ((tile["x"], tile["y"]),
             TERRAIN_COLORMAP.get(tile.get("type"))) for tile in self.tilemap.values()
        ]

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
        coords, _ = self.get_tile_by_index(idx)
        x, y = coords
        box = self.bounding(x, y)
        cropped = self.tiles.crop(box)
        return cropped


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
