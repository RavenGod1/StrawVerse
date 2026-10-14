<h6 align="right">Supports Android, Windows & Linux</h6>
<h1 align="center">
  <img src="assets/header_banner.svg" alt="StrawVerse Header - Fast Open Source Anime & Manga Downloader" width="100%">
</h1>

<h1 align="center">StrawVerse</h1>

> **A fast, open-source anime and manga downloader for Windows, Linux, and Android with batch downloads, subtitles, multiple sources, quality selection, and MyAnimeList integration.**

<p align="center">
  <a href="https://github.com/TheYogMehta/StrawVerse/stargazers">
    <img src="https://img.shields.io/github/stars/TheYogMehta/StrawVerse?style=for-the-badge&logo=github&color=gold" alt="GitHub Stars">
  </a>
  <a href="https://github.com/TheYogMehta/StrawVerse/releases">
    <img src="https://img.shields.io/github/v/release/TheYogMehta/StrawVerse?style=for-the-badge&logo=github&color=blue" alt="Latest Release">
  </a>
  <a href="https://github.com/TheYogMehta/StrawVerse/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/TheYogMehta/StrawVerse?style=for-the-badge&color=green" alt="License">
  </a>
  <a href="https://discord.gg/PzfUBgQ2gt">
    <img src="https://img.shields.io/discord/1514335663875555470?color=7289da&label=Discord&logo=discord&style=for-the-badge" alt="Discord">
  </a>
</p>

StrawVerse is a fast, open-source **anime downloader** and **manga downloader** for Windows, Linux, and Android. Search, stream, read, and run **batch anime downloads** and manga chapter downloads across multiple high-speed sources — all from one offline-first media manager.

Whether you want high-speed **anime download** queues in 1080p, full Sub and Dub subtitle extraction, synchronized watching with friends, or automatic MyAnimeList tracking, StrawVerse keeps your entire **anime & manga** library in one place.

<p align="center">
  <a href="https://github.com/TheYogMehta/StrawVerse/releases"><b>⬇ Download StrawVerse</b></a> •
  <a href="https://strawverse.theyogmehta.online"><b>🌐 Official Website</b></a> •
  <a href="https://discord.gg/PzfUBgQ2gt"><b>💬 Join Community Discord</b></a>
</p>

> **New in v10.1.4:** dead-mirror fast abort with automatic server switching, subtitle downloads through the hardened request path, and fixed Android remux. See [changelog.md](changelog.md) for details.

---

## Quick Download

| Platform    | Download Link                                                              | Format                           | OS Compatibility             |
| :---------- | :------------------------------------------------------------------------- | :------------------------------- | :--------------------------- |
| **Windows** | [StrawVerse.Setup.exe](https://github.com/TheYogMehta/StrawVerse/releases) | Installer (`.exe`)               | Windows 10, 11 (64-bit)      |
| **Linux**   | [StrawVerse.AppImage](https://github.com/TheYogMehta/StrawVerse/releases)  | Portable (`.AppImage` / `.snap`) | Ubuntu, Fedora, Arch, Debian |
| **Android** | [StrawVerse.apk](https://github.com/TheYogMehta/StrawVerse/releases)       | Mobile APK (`.apk`)              | Android 7.0+                 |

---

## Features

### Downloading

- **Batch anime episode downloads** — full series, seasons, or hand-picked episodes with parallel queue processing.
- **Manga chapter downloads** — volumes and chapters as CBZ or structured image folders for offline reading.
- **Fast parallel engine** — multi-threaded downloads with per-host speed tuning and automatic server switching on dead or slow mirrors.
- **Custom download location** — pick your own folder from Settings with one-click reset to default.

### Playback & Reading

- **In-app player & reader** — HTML5 video player with auto-skip intros/outros, timeline skip markers, and Picture-in-Picture; manga reader with Long Strip, Single Page, and Double Page layouts.
- **Watch Together** — host or join rooms to watch synchronously with friends, with shared queue and live chat.
- **Quality selection** — 360p through 1080p FHD with automatic resolution fallback.
- **Sub & Dub support** — Japanese subtitled and English dubbed releases, with subtitles saved as raw `.vtt` / `.ass` / `.srt` or merged into `.mp4`.

### Library & Tracking

- **MyAnimeList integration** — OAuth login with automatic episode/chapter tracking and list sync.
- **Library tracker** — watch/read history, airing calendar, stats dashboard, and Discord Rich Presence.
- **Unified Discover** — one search across anime and manga with genre, status, type, and sort filters.

### Platform

- **Cross-platform** — one shared interface and feature set on Windows, Linux, and Android.
- **Free & open source** — GPL-3.0, no ads, no locked features.

---

> [!IMPORTANT]
> **Legal Disclaimer:** StrawVerse is an open-source local media manager and indexing application designed for developers and researchers. The developers of this application do not host, store, stream, or distribute any copyrighted media (video, audio, or images). The application functions solely as a client-side parser and downloader wrapper utilizing publicly available web resource links. We do not condone, promote, or encourage copyright infringement. By using this software, you acknowledge and agree that all download and media-access activities are conducted at your own risk and responsibility, and that you are solely responsible for ensuring compliance with all local, national, and international copyright laws and terms of service.

## Table of Contents

- [Overview](#overview)
- [System Requirements](#system-requirements)
- [Installation](#installation)
  - [Android](#for-android)
  - [Windows](#for-windows)
  - [Linux](#for-linux)
  - [Other OS](#for-other-os-macos-etc)
- [Usage](#usage)
- [Videos](#videos)
- [Configuration](#configuration)
- [Uninstalling](#uninstalling-the-application)
- [Build the Application](#build-the-application)
  - [Prerequisites](#prerequisites)
  - [Desktop build](#steps-to-build)
  - [Android build](#build-and-run-the-android-application)

---

## Overview

**StrawVerse** is a cross-platform app built with Electron, Capacitor, React, and Vite. It streams, downloads, reads, and tracks your anime and manga collections, using a local SQLite database for your library and history.

## System Requirements

- **Operating System:** Windows 10/11 (64-bit), a modern Linux distribution, or Android 7.0+
- **Disk:** enough free space for your downloads (poster cache defaults to 5 GB, configurable)

## Installation

### For Android

1. Go to [StrawVerse Releases](https://github.com/TheYogMehta/StrawVerse/releases).
2. Download the APK file `StrawVerse-<version>.apk`.
3. Open and install the APK on your Android device.

### For Windows

1. Go to [StrawVerse Releases](https://github.com/TheYogMehta/StrawVerse/releases).
2. Download the setup file `StrawVerse.Setup.<version>.exe`.
3. Run the installer and enjoy!

### For Linux

1. Go to [StrawVerse Releases](https://github.com/TheYogMehta/StrawVerse/releases).
2. Download the AppImage `StrawVerse-<version>.AppImage` (or the snap / deb package).
3. For AppImage: make it executable with `chmod +x StrawVerse-<version>.AppImage` and run it.

### For Other OS (macOS, etc.)

- Pre-built binaries are not provided. Clone the repository and run it locally — see [Build the Application](#build-the-application).

## Usage

1. Launch the app (`StrawVerse.exe` on Windows, the `.AppImage` / Snap on Linux, or the app icon on Android).
2. **Search and Discover:** use the unified Discover page to search anime or manga; switch modes with the header toggle.
3. **Stream or Read:** open a title to watch in the built-in player or read chapters in the manga reader.
4. **Watch Together:** host or join a synced watch room with friends.
5. **Bulk Download:** pick episodes/chapters from the detail view, choose Sub/Dub/HSUB, and follow progress in the Downloads tab.

## Videos

### How to download and use `StrawVerse.exe`?

[![Watch the demo](https://img.youtube.com/vi/ZmcE-LrofgQ/0.jpg)](https://www.youtube.com/watch?v=ZmcE-LrofgQ)

<video src="https://github.com/user-attachments/assets/9042f0f9-be25-4705-a6a5-dace3a3539e0" controls="controls" muted="muted">How.mp4</video>

## Configuration

Open the Settings tab to configure StrawVerse:

1. **MyAnimeList Integration:** authenticate via OAuth to enable automatic list tracking.
2. **Player Settings:** subtitle styling and download preferences — save subtitle tracks as external files or merge them into the output MP4.
3. **Quality Preferences:** preferred resolution fallbacks for scrapers.
4. **Server & Mapping URL:** reset or configure the central mapping server address, with a built-in connection health test.
5. **Storage & Cache:** poster cache size limits (default 5 GB) with LRU eviction; per-session external log files with configurable retention.

## Uninstalling the Application

### For Windows

Navigate to `C:\Users\USERNAME\AppData\Local\Programs\StrawVerse` and run `Uninstall StrawVerse.exe`.

### For Linux

- **AppImage:** delete the `.AppImage` file. To clear settings too, delete `~/.config/strawverse`.
- **Snap:** run `sudo snap remove strawverse`.

---

# Build the Application

## Prerequisites

1. **Node.js** — [Download](https://nodejs.org/)
2. **Git** — [Download](https://git-scm.com/)
3. **Python** — [Download](https://www.python.org/downloads/)
4. **C++ build tools (Windows only)** — required for native modules via node-gyp. Either tick **"Automatically install the necessary tools"** during Node.js setup, or install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload.
5. **Android SDK / Android Studio** — only needed for the [Android build](#build-and-run-the-android-application).

## Steps to Build

1. Clone the repository:

   ```bash
   git clone https://github.com/TheYogMehta/StrawVerse.git
   cd StrawVerse
   ```

2. Build the desktop app (builds the GUI, then packages Windows + Linux installers into `electron/dist`):

   ```bash
   npm run build:desktop
   ```

3. Or run it in development mode:

   ```bash
   npm run start:desktop
   ```

> **Note:** building Linux targets (AppImage/snap) from Windows is not supported — build those on Linux. On Windows, package with `npx electron-builder --win` inside `electron/` instead.

## Build and Run the Android Application

1. Install dependencies:

   ```bash
   npm install
   cd capacitor && npm install
   ```

2. Sync the Android project (builds GUI, bundles backend, syncs with Capacitor):

   ```bash
   npm run sync:android
   ```

3. Build the release APK (outputs to `capacitor/android/app/build/outputs/apk/release/app-release.apk`):

   ```bash
   npm run package:android
   ```

4. Run it — either `npx cap run android` from a terminal, or `npx cap open android` to launch Android Studio.

---

- Ensure Node.js and Git are up to date for best compatibility.
- Issues or questions? Open an issue or join the [Discord Server](https://discord.gg/PzfUBgQ2gt).
