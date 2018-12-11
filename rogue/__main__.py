import sys
import random

import pygame
from pygame import locals

from .world import Player, World, Tile

TILESIZE = 32
WINDOW_SIZE = 20
TILESHEET = "data/tiles.png"

TILEMAP = {
    "grass1": (15, 9),
    "gnome1": (2, 59),
    "wall1": (10, 4),
}


def generate_map(size):

    WALLS = [(random.randint(0, WINDOW_SIZE), random.randint(0, WINDOW_SIZE)) for _ in range(10)]

    def _tile(x, y):
        if (x, y) in WALLS:
            return Tile("wall1", blocked=True, blocked_sight=True)
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


class MapView(object):
    def __init__(self, surface, world, tileset, tilesize):
        self.surface = surface
        self.world = world
        self.tileset = tileset
        self.tilesize = tilesize

    def draw(self):
        def _blit(key, x, y):
            dest = pygame.Rect(x * self.tilesize, y * self.tilesize, 0, 0)
            area = self.tileset.get_tile(key)
            return self.tileset.bitmap, dest, area

        blits = [_blit(tile.key, x, y) for y, row in enumerate(self.world.map) for x, tile in enumerate(row)]
        blits += [_blit(obj.key, obj.x, obj.y) for obj in self.world.objects]
        
        dirty = []
        for src, dst, area in blits:
            d = self.surface.blit(src, dst, area)
            dirty.append(d)

        return dirty


def print_fov(world, player):
    visible = world.fov(player)
    fov = [[(" " if (x, y) in visible else "x") for x in range(WINDOW_SIZE)] for y in range(WINDOW_SIZE)]
    for row in fov:
        print("".join(row))
    print()


def main():
    width = height = TILESIZE * WINDOW_SIZE
    screen = pygame.display.set_mode((width, height))

    image = pygame.image.load(TILESHEET).convert_alpha()
    tileset = TileSet(image, TILEMAP, TILESIZE)
    tiles = generate_map(WINDOW_SIZE)
    player = Player("gnome1", int(round(WINDOW_SIZE/2)), int(round(WINDOW_SIZE/2)))
    world = World(tiles, player)

    view = MapView(screen, world, tileset, TILESIZE)

    running = True
    while running:
        for event in pygame.event.get():
            
            if event.type == locals.KEYDOWN and event.key == locals.K_ESCAPE:
                running = False
                break
            elif event.type == locals.KEYDOWN and event.key == locals.K_w:
                world.move(player, 0, -1)
            elif event.type == locals.KEYDOWN and event.key == locals.K_s:
                world.move(player, 0, 1)
            elif event.type == locals.KEYDOWN and event.key == locals.K_a:
                world.move(player, -1, 0)
            elif event.type == locals.KEYDOWN and event.key == locals.K_d:
                world.move(player, 1, 0)

            # print_fov(world, player)

            dirty = view.draw()
            pygame.display.update(dirty)
            
    return 0


if __name__ == "__main__":
    pygame.init()
    try:
        rv = main()
    except KeyboardInterrupt:
        rv = 0
    pygame.quit()
    sys.exit(rv)
