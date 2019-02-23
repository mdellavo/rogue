from rogue import procgen


WIDTH, HEIGHT = 120, 40
MIN_SIZE = 4


def print_dungeon(rows):
    return "\n".join(["".join([" " if inside else "#" for inside in row]) for row in rows])


rooms, tunnels = procgen.generate_dungeon(WIDTH, HEIGHT, MIN_SIZE)
rows = procgen.render_dungeon(WIDTH, HEIGHT, rooms, tunnels)

print(print_dungeon(rows))
