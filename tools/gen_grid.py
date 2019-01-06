import sys

from PIL import Image, ImageDraw, ImageFont


def main():

    if len(sys.argv) < 4:
        print("USAGE: {} [source_path] [tilesize] [output_path]".format(sys.argv[0]))
        return 1

    source_path, tilesize, output_path = sys.argv[1:4]
    im = Image.open(source_path)
    tilesize = int(tilesize)

    width, height = im.size
    tiles_wide = width / tilesize
    tiles_tall = height / tilesize

    print("image {} x {} -> tiles {} x {} @ {}px".format(width, height, tiles_wide, tiles_tall, tilesize))
    font = ImageFont.truetype("data/Roboto-Regular.ttf", size=14)

    draw = ImageDraw.Draw(im)
    for y in range(0, height, tilesize):
        for x in range(0, width, tilesize):
            label = "{},{}".format(int(x/tilesize), int(y/tilesize))
            draw.text((x, y), label, font=font)
    im.save(output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
