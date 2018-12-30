import sys
import logging

import pygame
from pygame import locals

from .world import Actor
from .view import TileSet, MapView
from . import procgen

MAP_SIZE = 100
TILESIZE = 64
WINDOW_SIZE = 12
TILESHEET = "data/tiles.png"
TIMEOUT = 250

TILEMAP = {
    "player": (0, 3),
    "orc1": (14, 13),

    "grass1": (9, 23),
    "grass2": (10, 23),
    "grass3": (11, 23),

    "water1": (15, 23),
    "water2": (16, 23),
    "water3": (17, 23),

    "sand1": (12, 23),
    "sand2": (13, 23),
    "sand3": (14, 23),

    "mountains1": (117, 23),
    "mountains2": (118, 23),
    "mountains3": (119, 23),

    "crypt1": (7, 22),

    "grey3": (8, 24),

    "wall3": (2, 22),
}

TICK_EVENT = pygame.USEREVENT


logging.basicConfig(level=logging.DEBUG)
log = logging.getLogger(__name__)


def print_cells(cells):
    for row in cells:
        print("".join(("#" if cell else " ") for cell in row))


def print_heightmap(heightmap):

    def _height(height):
        if height < .2:
            return " "
        if height < .4:
            return "_"
        if height < .6:
            return "."
        if height < .8:
            return "o"
        return "O"

    for row in heightmap:
        print("".join(_height(height) for height in row))


def print_tiles(tiles):

    def _t(tile):
        if not tile:
            return "x"
        return "o" if tile.blocked else "."

    for row in tiles:
        print("".join(_t(tile) for tile in row))
    print()


def main():
    width = height = TILESIZE * WINDOW_SIZE

    log.info("generating world...")
    world = procgen.generate_world(MAP_SIZE)

    player = Actor("player")
    world.add_actor(player)

    pygame.init()
    screen = pygame.display.set_mode((width, height), 0, 32)

    log.info("loading tiles...")
    image = pygame.image.load(TILESHEET).convert_alpha()
    tileset = TileSet(image, TILEMAP, TILESIZE)
    view = MapView(world, player, tileset)

    def _tick():
        world.tick()
        view.draw(screen)
        pygame.display.flip()

    pygame.time.set_timer(TICK_EVENT, TIMEOUT)

    running = True
    try:
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
                elif event.type == locals.KEYDOWN and event.key == locals.K_PERIOD:
                    world.enter(player)
    except KeyboardInterrupt:
        pass

    pygame.quit()

    return 0


if __name__ == "__main__":
    sys.exit(main())
