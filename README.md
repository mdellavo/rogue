# Rogue

a rogue-like/lite with an asyncio python backend, javscript/websocket based frontend.

## Demo

http://rogue.quuux.org

## Features

- multiplayer, async backend
- procedurally generated maps
- realtime websocket base game play
- efficient msgpack based protocol

## Development

```bash
# run backend
python -m rogue

# run react dev server
yarn start

# with docker
docker build . -t mdellavo/rogue
docker run --rm  -i -t -v `pwd`:/home/rogue -p 6543:6543 --name rogue mdellavo/rogue

# deploy web to s3
./venv/bin/fab build-web deploy-web
```

## Todo / Bugs

- experience
- leader board
- ranged weapons
- magic
- threejs ui
- noises / chat?
- towns / prefabs / stores
- animations?

## Author

Marc DellaVolpe  (marc.dellavolpe@gmail.com)

## Copyright

Copyright &copy; 2019 Marc DellaVolpe

## License

_todo_

## Credits

Thanks to Dungeon Crawl Stone Soup for the artwork!!!

Thanks to https://www.purple-planet.com/ for the awesome music
