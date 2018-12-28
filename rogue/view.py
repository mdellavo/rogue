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
    def __init__(self, world, player, tileset):
        self.world = world
        self.player = player
        self.tileset = tileset

    def visible_tiles(self, area, width, height):
        rv = []
        for y in range(height):
            row = []
            for x in range(width):
                tile_x = x + self.player.x - int(width / 2)
                tile_y = y + self.player.y - int(height / 2)
                if tile_x < 0 or tile_x >= area.map_width or tile_y < 0 or tile_y >= area.map_height:
                    row.append(((tile_x, tile_y), None))
                    continue
                tile = area.get_tile(tile_x, tile_y)
                row.append(((tile_x, tile_y), tile))
            rv.append(row)
        return rv

    def draw(self, surface):
        surface.fill((0, 0, 0))
        fov = self.world.explore(self.player)
        width = int(surface.get_width() / self.tileset.tile_size)
        height = int(surface.get_height() / self.tileset.tile_size)
        area = self.world.get_area(self.player)
        tiles = self.visible_tiles(area, width, height)

        object_map = {(obj.x, obj.y): obj for obj in area.objects}

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
                    surface.blit(self.tileset.bitmap, dest, area)

                    if pos in fov:
                        if pos in object_map:
                            obj = object_map[pos]
                            area = self.tileset.get_tile(obj.key)
                            surface.blit(self.tileset.bitmap, dest, area)
                    else:
                        surface.fill((128, 128, 128, 128), dest, pygame.BLEND_RGBA_MULT)


