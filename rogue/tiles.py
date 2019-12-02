import io
import os
import collections
import hashlib
import dataclasses
import yaml

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

COLORMAP_VALUES = {
    "gold": (255, 215, 0, 0),
    "green": (0, 128, 0, 0),
    "blue": (0, 0, 255, 0),
    "yellow": (255, 255, 0, 0),
    "grey": (128, 128, 128, 0),
    "purple": (128, 0, 128, 0),
    "lightgrey": (211, 211, 211, 0),
    "dimgrey": (105, 105, 105, 0),
}


class TileSet(object):
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            self.data = yaml.safe_load(f)

        self.index_map = {k: i for i, k in enumerate(self.tilemap)}
        self.indexed_map = [
            ((tile["x"], tile["y"]),
             TERRAIN_COLORMAP.get(tile.get("type"))) for tile in self.tilemap.values()
        ]

    @property
    def tiles_path(self):
        return os.path.join(os.path.dirname(self.path), self.data["path"])

    @property
    def tilemap(self):
        return self.data["tilemap"]

    @property
    def tilesize(self):
        return self.data["tilesize"]

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

    def get_tile_color(self, key):
        tile = self.tilemap.get(key)
        tile_type = tile.get("type")
        color = TERRAIN_COLORMAP.get(tile_type)
        value = COLORMAP_VALUES.get(color)
        return value

    def get_tile_rect(self, key):
        t = self.tilemap[key]
        x, y = t["x"], t["y"]
        r = self.bounding(x, y)
        return r


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight

    def activate(self, actor, world):
        pass


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


class Trap(Tile):
    def activate(self, actor, area):
        actor.notice("you stepped on a trap")
        self.key = "lava1"
