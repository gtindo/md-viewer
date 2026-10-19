# Contributing

MDView is a personal tool. I built it for my own workflow, reading the docs
that coding agents write in my repositories, and I share it as is in case it
is useful to others. It follows my priorities and the time I have for it, so
please read this before opening an issue.

## New features: fork it

I don't take feature requests, and I don't merge pull requests. If you want
MDView to do something it doesn't, you are warmly encouraged to **fork the
project** and make it your own. The code is under the [MIT License](LICENSE),
so you can change, rebuild and redistribute it freely.
[DEVELOPMENT.md](DEVELOPMENT.md) explains how the project is organised and how
to build and test both apps.

## Bugs: report them, without code

Bug reports are welcome. Please **open an issue with a description and the
context needed to reproduce the problem, and no code**: no patches, pull
requests or suggested fixes. I prefer to investigate and fix bugs myself, and
an exact description of what went wrong is the most useful thing you can give
me.

A good report includes:

- **Version and platform:** the MDView version (Help → About on Linux,
  MDView → About MDView on macOS), the operating system and version, and the
  architecture (Apple Silicon or Intel; x86-64 or ARM64). On Linux, also the
  distribution, the desktop (GNOME, KDE, …) and Wayland or X11.
- **Steps to reproduce:** what you opened and what you did, one step at a time.
- **Expected and actual result:** what you expected to happen, and what
  happened instead.
- **A minimal markdown sample** that shows the problem, especially for
  rendering or diagram issues: the smallest file, or Mermaid block, that still
  reproduces it. Remove anything private.
- **Screenshots or a screen recording** when the problem is visual.
- **Logs**, if the app crashes or misbehaves. Start it from a terminal with
  `MDVIEW_DEBUG=1`:

  ```sh
  MDVIEW_DEBUG=1 /Applications/MDView.app/Contents/MacOS/MDView      # macOS
  MDVIEW_DEBUG=1 ./MDView-1.0.0-linux-amd64.AppImage                   # Linux
  ```

Please search existing issues first, and keep one problem per issue.

I read every report, but I can't promise a fix or a timeline. Pull requests
will be closed without review, whatever their quality. That says nothing about
your work; it is simply how I keep this project manageable.

Thank you for taking the time to report a problem.
