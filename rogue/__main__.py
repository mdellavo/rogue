import sys
import asyncio
import logging
import collections

from .view import TileSet
from . import procgen, server

TIMEOUT = .1
MAP_SIZE = 100
TILESIZE = 64

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
    ("grey3", (8, 24)),
    ("wall3", (2, 22)),
    ("coin1", (7, 7)),
    ("coin2", (8, 7)),
    ("coin3", (9, 7)),
    ("coin4", (10, 7)),
    ("coin5", (11, 7)),
))


logging.basicConfig(level=logging.DEBUG)
log = logging.getLogger(__name__)


async def main():
    log.info("generating world...")
    world = procgen.generate_world(MAP_SIZE)
    log.info("loading tiles...")
    tileset = TileSet(TILEMAP, TILESIZE)

    async def run_world():
        log.info("starting world...")
        while True:
            world.tick()
            await asyncio.sleep(TIMEOUT)

    await asyncio.gather(run_world(), server.run_server(world, tileset))

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    sys.exit(0)
