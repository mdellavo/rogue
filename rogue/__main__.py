import sys
import random

import pygame
from pygame import locals

from .world import Player, World, Tile, NPC

TILESIZE = 32
WINDOW_SIZE = 20
TILESHEET = "data/tiles.png"
TIMEOUT = 250

TILEMAP = {
    "grass1": (15, 9),
    "gnome1": (2, 59),
    "wall1": (10, 4),
    "orc1": (9, 59),
}

TICK_EVENT = pygame.USEREVENT


def generate_map(size):

    WALLS = [(random.randint(0, size), random.randint(0, size)) for _ in range(10)]

    def _tile(x, y):
        if (x, y) in WALLS:
            return Tile("wall1", blocked=True)
        else:
            return Tile("grass1")

    return [[_tile(w, h) for w in range(size)] for h in range(size)]


class TileSet(object):
    def __init__(self, bitmap, tilemap, tile_size):
        self.bitmap = bitmap
        self.tilemap = tilemap  # XXX build a map of rects
        self.tile_size = tile_size

    def get_tile(self, key):
        x, y = self.tilemap[key]
        r = pygame.Rect(x * self.tile_size, y * self.tile_size, self.tile_size, self.tile_size)
        return r


def print_tiles(tiles):

    def _t(tile):
        if not tile:
            return "x"
        return "o" if tile.blocked else "."

    for row in tiles:
        print("".join(_t(tile) for tile in row))
    print()


class MapView(object):
    def __init__(self, surface, world, tileset, tilesize):
        self.surface = surface
        self.world = world
        self.tileset = tileset
        self.tilesize = tilesize

    @property
    def visible_width(self):
        return int(self.surface.get_width() / self.tilesize)

    @property
    def visible_height(self):
        return int(self.surface.get_height() / self.tilesize)

    def visible_tiles(self):
        rv = []
        for y in range(self.visible_height):
            row = []
            for x in range(self.visible_width):
                tile_x = x + self.world.player.x - int(self.visible_width / 2)
                tile_y = y + self.world.player.y - int(self.visible_height / 2)
                if tile_x < 0 or tile_x >= self.world.map_width or tile_y < 0 or tile_y >= self.world.map_height:
                    row.append(((tile_x, tile_y), None))
                    continue
                tile = self.world.get_tile(tile_x, tile_y)
                row.append(((tile_x, tile_y), tile))
            rv.append(row)
        return rv

    def draw(self):
        self.surface.fill((0, 0, 0))
        fov = self.world.player_fov()
        tiles = self.visible_tiles()

        object_map = {(obj.x, obj.y): obj for obj in self.world.objects}

        for y, row in enumerate(tiles):
            for x, cell in enumerate(row):
                pos, tile = cell

                if tile and tile.explored:
                    dest = pygame.Rect(x * self.tilesize, y * self.tilesize, self.tilesize, self.tilesize)
                    area = self.tileset.get_tile(tile.key)
                    self.surface.blit(self.tileset.bitmap, dest, area)

                    if pos in object_map:
                        obj = object_map[pos]
                        area = self.tileset.get_tile(obj.key)
                        self.surface.blit(self.tileset.bitmap, dest, area)


def main():
    width = height = TILESIZE * WINDOW_SIZE
    screen = pygame.display.set_mode((width, height))

    image = pygame.image.load(TILESHEET).convert_alpha()
    tileset = TileSet(image, TILEMAP, TILESIZE)
    tiles = generate_map(WINDOW_SIZE)
    player = Player("gnome1", int(WINDOW_SIZE/2), int(WINDOW_SIZE/2))
    npcs = [NPC("orc1", random.randint(0, WINDOW_SIZE), random.randint(0, WINDOW_SIZE)) for _ in range(10)]
    world = World(tiles, player, npcs)
    view = MapView(screen, world, tileset, TILESIZE)

    def _tick():
        world.tick()
        view.draw()
        pygame.display.flip()

    pygame.time.set_timer(TICK_EVENT, TIMEOUT)

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == locals.KEYDOWN and event.key == locals.K_ESCAPE:
                running = False
                break
            elif event.type == TICK_EVENT:
                _tick()
            elif event.type == locals.KEYDOWN and event.key == locals.K_w:
                world.move(player, 0, -1)
            elif event.type == locals.KEYDOWN and event.key == locals.K_s:
                world.move(player, 0, 1)
            elif event.type == locals.KEYDOWN and event.key == locals.K_a:
                world.move(player, -1, 0)
            elif event.type == locals.KEYDOWN and event.key == locals.K_d:
                world.move(player, 1, 0)

    return 0


if __name__ == "__main__":
    pygame.init()
    try:
        exit_val = main()
    except KeyboardInterrupt:
        exit_val = 0
    pygame.quit()
    sys.exit(exit_val)
