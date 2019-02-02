import math
import random
import dataclasses

from .objects import Actor


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight
        self.explored = False


@dataclasses.dataclass
class Door(Tile):
    def __init__(self, key, area=None, position=None, **kwargs):
        super(Door, self).__init__(key, **kwargs)
        self.area = area
        self.position = position

    def get_area(self, exit_area, exit_position):
        if not self.area:
            return ValueError("door needs area")
        return self.area, self.position


class Area(object):
    def __init__(self, tiles):
        self.tiles = tiles
        self.objects = []
        self.time = 0

    @property
    def map_width(self):
        return len(self.tiles[0])

    @property
    def map_height(self):
        return len(self.tiles)

    def get_tile(self, x, y):
        if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
            return None
        return self.tiles[y][x]

    def get_objects(self, x, y):
        return [obj for obj in self.objects if obj.x == x and obj.y == y]

    def is_tile_free(self, x, y):
        if self.get_tile(x, y).blocked:
            return False

        objs = self.get_objects(x, y)
        if objs and any(obj.blocks for obj in objs):
            return False

        return True

    def add_object(self, obj, x, y):
        if obj in self.objects:
            raise ValueError("obj already in area")

        if self.is_tile_free(x, y):
            obj.x = x
            obj.y = y
            self.objects.append(obj)
            return True
        return False

    def remove_object(self, obj):
        if obj not in self.objects:
            raise ValueError("obj not in area")
        self.objects.remove(obj)

    def tick(self, world):
        self.time += 1
        for obj in self.objects:
            obj.tick(world)

    def place(self, obj):
        for _ in range(100):
            x = random.randrange(0, self.map_width)
            y = random.randrange(0, self.map_height)
            if self.add_object(obj, x, y):
                return
        raise ValueError("could not place object")

    def move(self, actor, dx, dy):
        x = actor.x + dx
        y = actor.y + dy

        if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
            return False

        tile = self.get_tile(x, y)
        if tile.blocked or any(obj.blocks for obj in self.get_objects(x, y)):
            return False

        actor.x = x
        actor.y = y

        return True

    def immediate_area(self, actor):
        immediate = [(actor.x, actor.y)]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                x = actor.x + dx
                y = actor.y + dy
                if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
                    continue
                immediate.append((x, y))
        return immediate

    def fov(self, actor):
        visible = [(actor.x, actor.y)]
        for theta in range(361):
            ax = math.cos(math.radians(theta))
            ay = math.sin(math.radians(theta))
            for i in range(1, actor.view_distance):
                px = actor.x + int(round(i * ax))
                py = actor.y + int(round(i * ay))
                if px < 0 or px >= self.map_width or py < 0 or py >= self.map_height:
                    continue
                tile = self.get_tile(px, py)
                pos = (px, py)
                if pos not in visible:
                    visible.append(pos)
                if tile.blocked_sight or any(obj.blocks_sight for obj in self.get_objects(px, py)):
                    break

        return visible

    def explore(self, actor):
        visible = self.fov(actor)
        for x, y in visible:
            tile = self.get_tile(x, y)
            tile.explored = True
        return visible


class World(object):
    def __init__(self, area):
        self.areas = [area]
        self.actor_area = {}
        self.age = 0

    def add_actor(self, actor, area=None):
        if not area:
            area = self.areas[0]
        if area not in self.areas:
            self.areas.append(area)
        self.actor_area[id(actor)] = area
        return area

    def place_actor(self, actor):
        self.add_actor(actor).place(actor)

    def remove_actor(self, actor):
        return self.get_area(actor).remove_object(actor)

    def get_area(self, actor):
        return self.actor_area.get(id(actor))

    def tick(self):
        for area in self.areas:
            area.tick(self)
        self.age += 1

    def move(self, actor, dx, dy):
        area = self.get_area(actor)
        return area.move(actor, dx, dy)

    def fov(self, actor):
        area = self.get_area(actor)
        return area.fov(actor)

    def explore(self, actor):
        area = self.get_area(actor)
        return area.explore(actor)

    def enter(self, actor):
        area = self.get_area(actor)
        pt = area.get_tile(actor.x, actor.y)
        if isinstance(pt, Door):
            new_area, position = pt.get_area(area, (actor.x, actor.y))
            self.add_actor(actor, area=new_area)
            x, y = position
            new_area.add_object(actor, x, y)
            area.remove_object(actor)
            actor.notice("you have entered {}".format(new_area))
        else:
            actor.notice("there is no door here")

    def inspect(self, actor):
        rv = []
        area = self.get_area(actor)
        for x, y in area.immediate_area(actor):
            tile = area.get_tile(x, y)
            objs = [obj for obj in area.get_objects(x, y) if obj is not actor]
            rv.append(((x, y), tile, objs))
        return rv

    def pickup(self, actor):
        area = self.get_area(actor)
        objs = [obj for obj in area.get_objects(actor.x, actor.y) if not (obj is actor or obj.anchored)]

        if not objs:
            actor.notice("there is nothing to pickup")
            return

        for obj in objs:
            area.remove_object(obj)
            actor.pickup(obj)
            actor.notice("you picked up {}".format(obj))

    def surrounding_actors(self, actor):
        area = self.get_area(actor)
        rv = []
        for x, y in area.immediate_area(actor):
            rv.extend([obj for obj in area.get_objects(x, y) if obj is not actor and isinstance(obj, Actor)])
        return rv

    def melee(self, actor, target=None):
        if not target:
            targets = self.surrounding_actors(actor)
            if targets:
                target = targets[0]

        if not target:
            actor.notice("there is nothing to attack")
            return

        attack = random.randint(0, 20)
        if attack <= 1:
            actor.notice("you missed {}".format(target))
            return

        damage = actor.strength + attack

        critical = attack >= 10
        if not critical:
            damage -= target.armor_class

        if damage < 0:
            actor.notice("you did no damage")

        target.hit_points -= damage

        if critical:
            actor.notice("critical hit on {} for {} damage!!!".format(target, damage))
        else:
            actor.notice("hit on {} for {} damage!".format(target, damage))

