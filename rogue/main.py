import os
import argparse
import asyncio
import logging
import sys
import time
import random

import uvicorn
from jinja2 import Environment, PackageLoader, select_autoescape

from . import procgen
from .server import app
from .tiles import TileSet
from .world import DAY, TIMEOUT

MAP_SIZE = 200
TILESET_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "tileset.yaml")

logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s/%(name)s - %(message)s')
log = logging.getLogger(__name__)


def create_app():

    seed = int(time.time())

    log.info("starting world with seed %s", seed)
    random.seed(seed)
    world = procgen.generate_world(MAP_SIZE)
    tileset = TileSet(TILESET_PATH)

    app.state.world = world
    app.state.tileset = tileset
    app.state.jinja = Environment(
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

    @app.on_event("startup")
    async def startup():
        log.info("server startup...")
        asyncio.create_task(run_world())

    @app.on_event("shutdown")
    async def shutdown():
        log.info("server shutdown...")

    return app
