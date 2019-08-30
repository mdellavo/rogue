import argparse
import asyncio
import logging
import sys
import time
import random

from . import procgen, server
from .tiles import TILEMAP, TileSet
from .world import DAY, TIMEOUT

MAP_SIZE = 100
TILESIZE = 64
PORT = 8000

logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s/%(name)s - %(message)s')
log = logging.getLogger(__name__)


async def main(args):

    log.info("starting world with seed %s", args.seed)
    random.seed(args.seed)

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

    await asyncio.gather(run_world(), server.run_server(world, tileset, args.port))

if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=int(time.time()))
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--debug")
    args = parser.parse_args()
    try:
        asyncio.run(main(args), debug=args.debug)
    except KeyboardInterrupt:
        pass
    sys.exit(0)
