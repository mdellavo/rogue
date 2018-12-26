import pygame


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
    def __init__(self, surface, world, tileset):
        self.surface = surface
        self.world = world
        self.tileset = tileset

    @property
    def visible_width(self):
        return int(self.surface.get_width() / self.tileset.tile_size)

    @property
    def visible_height(self):
        return int(self.surface.get_height() / self.tileset.tile_size)

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
                    dest = pygame.Rect(
                        x * self.tileset.tile_size,
                        y * self.tileset.tile_size,
                        self.tileset.tile_size,
                        self.tileset.tile_size
                    )
                    area = self.tileset.get_tile(tile.key)
                    self.surface.blit(self.tileset.bitmap, dest, area)

                    if pos in fov:
                        if pos in object_map:
                            obj = object_map[pos]
                            area = self.tileset.get_tile(obj.key)
                            self.surface.blit(self.tileset.bitmap, dest, area)
                    else:
                        self.surface.fill((128, 128, 128, 128), dest, pygame.BLEND_RGBA_MULT)


