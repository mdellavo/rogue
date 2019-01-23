class TileSet(object):
    def __init__(self, tilemap, tilesize):
        self.tilemap = tilemap  # XXX build a map of rects
        self.index_map = {k: i for i, k in enumerate(self.tilemap)}
        self.tilesize = tilesize

    def get_tile(self, key):
        x, y = self.tilemap[key]
        r = (x * self.tilesize, y * self.tilesize, self.tilesize, self.tilesize)
        return r

    def get_index(self, key):
        return self.index_map[key]

    def get_indexed_map(self):

        def _tile(k):
            return {
                "key": k,
                "coords": self.tilemap[k]
            }

        return [_tile(k) for k in self.tilemap.keys()]

