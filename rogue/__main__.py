import sys
import asyncio
import logging

from . import procgen, server
from .tiles import TileSet, TILEMAP
from .world import TIMEOUT, DAY

MAP_SIZE = 100
TILESIZE = 64


logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s/%(name)s - %(message)s')
log = logging.getLogger(__name__)


async def main():
    world = procgen.generate_world(MAP_SIZE)
    tileset = TileSet(TILEMAP, TILESIZE)

    async def run_world():
        log.info("starting world...")

        while True:
            world.tick()

            day, mod = divmod(world.age, DAY)
            if not mod:
                for player in world.players:
                    player.notice("day {}".format(day))

            await asyncio.sleep(TIMEOUT)

    await asyncio.gather(run_world(), server.run_server(world, tileset))

if __name__ == "__main__":
    debug = "--debug" in sys.argv
    try:
        asyncio.run(main(), debug=debug)
    except KeyboardInterrupt:
        pass
    sys.exit(0)
