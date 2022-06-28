import os
import argparse
import asyncio
import logging
import sys
import time
import random

import uvicorn
from jinja2 import Environment, PackageLoader, select_autoescape

from . import procgen, server
from .tiles import TileSet
from .world import DAY, TIMEOUT

PORT = 6543

MAP_SIZE = 200
TILESET_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "tileset.yaml")


logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s/%(name)s - %(message)s')
log = logging.getLogger(__name__)


def main(args):

    log.info("starting world with seed %s", args.seed)
    random.seed(args.seed)
    world = procgen.generate_world(MAP_SIZE)
    tileset = TileSet(TILESET_PATH)

    server.app.state.world = world
    server.app.state.tileset = tileset
    server.app.state.jinja = Environment(
        loader=PackageLoader("rogue", 'templates'),
        autoescape=select_autoescape(['html', 'xml'])
    )

    async def run_world():
        log.info("starting world...")

        while True:
            world.tick()

            day, mod = divmod(world.age, DAY)
            if not mod:
                for player in world.players:
                    player.notice("day {}".format(day))

            await asyncio.sleep(TIMEOUT)

    @server.app.on_event("startup")
    async def startup():
        log.info("server startup...")
        asyncio.create_task(run_world())

    @server.app.on_event("shutdown")
    async def shutdown():
        log.info("server shutdown...")

    uvicorn.run(server.app,
                host="0.0.0.0",
                port=args.port,
                # log_level="debug",
                )

if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=int(time.time()))
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    try:
        main(args)
    except KeyboardInterrupt:
        pass
    sys.exit(0)
