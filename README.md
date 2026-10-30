# Zetamac Local

A Zetamac-style arithmetic game for Mac. It works offline and keeps your runs on your computer.

Timed practice, Zen mode, run history, a progress graph, and basic stats. You can delete runs and export them as CSV.

Escape stops any run and shows its stats without saving it. The End run button does the same for timed runs. In Zen mode, use Finish and save to keep the session.

## Run it

On a Mac with Xcode Command Line Tools installed:

```sh
git clone https://github.com/threepoint1four/zetamac-local.git
cd zetamac-local
./build.sh
./zetamac
```

To launch it from anywhere, link the launcher into a directory on your `PATH`:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/zetamac" ~/.local/bin/zetamac
zetamac
```

If `zetamac` isn't found, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` and open a new Terminal window.

Run history lives in `~/Library/Application Support/Zetamac Local/runs.sqlite3`.

Inspired by [Zetamac](https://arithmetic.zetamac.com/) and [sryaengbl/Zetamac](https://github.com/sryaengbl/Zetamac).
