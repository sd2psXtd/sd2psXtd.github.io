![sd2psXtd Logo](img/Logo.png)
 *Logo by Berion ❤️*

# sd2psXtd Firmware

*Latest stable version:* **{{ site.firmware_version }}** — [Download firmware](download.md)

### New in {{ site.firmware_version }}

- **USB serial** can connect while the memory card is still loading.
- **Windows support** restores automatic WinUSB driver binding for `picotool` reboot in Serial and USB mass storage modes.
- **USB detection** starts earlier at boot and gives the host time to recognize the disconnect when switching USB profiles.
- **Flash writes** are protected from interrupts when installing a PS2 CIV key or a custom boot splash.

[Full release notes](https://github.com/sd2psXtd/firmware/releases/tag/{{ site.firmware_version }})

sd2psXtd is an extended firmware for the popular *Multipurpose MemoryCard Emulator* sd2psx by developer @xyzz (see [here](https://github.com/sd2psx)). It combines cutting-edge extended functionality (like game ID switching, file system access, and dynamic mode selection) with the rock-solid performance of the original sd2psx firmware.

It provides the same functionality as the official stable firmware and extends it with the following features:

<div class="SideNav border">
<a class="SideNav-item" href="#ps2-game-id-switching">{% include ps2tag.liquid %} Game ID switching</a>
<a class="SideNav-item" href="#ps2-ps1-dynamic-mode-selection">{% include ps2tag.liquid %} PS1 dynamic mode selection</a>
<a class="SideNav-item" href="#ps2-mmceman-and-mmcedrv-support">{% include ps2tag.liquid %} MMCEMAN and MMCEDRV support</a>
<a class="SideNav-item" href="#ps2-instant-card-availability">{% include ps2tag.liquid %} Instant card availability</a>
<a class="SideNav-item" href="#ps2-1-128-mb-card-size-support">{% include ps2tag.liquid %} 1-128 MB card size support</a>
<a class="SideNav-item" href="#ps2-support-for-developer-arcade-and-prototype-ps2s">{% include ps2tag.liquid %} Support for developer, Arcade and Prototype PS2 models.</a>
<a class="SideNav-item" href="#ps1-bootcard-mechanics">{% include ps1tag.liquid %} BootCard mechanics</a>
<a class="SideNav-item" href="#ps1-psram-support">{% include ps1tag.liquid %} PSRAM support</a>
<a class="SideNav-item" href="#ps1-card-switch-controller-combo-support">{% include ps1tag.liquid %} Card Switch Controller Combo Support </a>
<a class="SideNav-item" href="#ps1-super-fast-freepsxboot">{% include ps1tag.liquid %} Super fast FreePSXBoot </a>
<a class="SideNav-item" href="#ps1-net-yaroze-support">{% include ps1tag.liquid %} Net Yaroze Support </a>
<a class="SideNav-item" href="#general-sd-card-layouts">{% include generaltag.liquid %} SD card layouts</a>
<a class="SideNav-item" href="#general-settings-file">{% include generaltag.liquid %} Settings file</a>
<a class="SideNav-item" href="#general-support-for-other-rp2040-based-mmce-devices">{% include generaltag.liquid %} Support for other RP2040-based MMCE devices</a>
<a class="SideNav-item" href="#general-per-card-config">{% include generaltag.liquid %} Per Card Config</a>
<a class="SideNav-item" href="#general-template-cards">{% include generaltag.liquid %} Template Cards</a>
<a class="SideNav-item" href="#general-game2folder-mapping">{% include generaltag.liquid %} Game2Folder mapping</a>
<a class="SideNav-item" href="#general-splash-screen-13">{% include generaltag.liquid %} Splash Screen</a>
<a class="SideNav-item" href="#general-game-image-screen-13">{% include generaltag.liquid %} Game Image Screen</a>
<a class="SideNav-item" href="#general-usb-modes-150">{% include generaltag.liquid %} USB modes</a>
<a class="SideNav-item" href="#general-usb-mass-storage">{% include generaltag.liquid %} USB Mass storage</a>
<a class="SideNav-item" href="#general-usb-ps3-memory-card-adaptor-emulation">{% include generaltag.liquid %} PS3 MCA emulation</a>
<a class="SideNav-item" href="#general-usb-cdc-command-interface">{% include generaltag.liquid %} USB-CDC command interface</a>

</div>

## PS2: Game ID Switching

Like on PS1, *sd2psXtd* can detect the game ID of a PS2 console and switch to a dedicated card per game. Game ID switching can be turned off in the device settings for PS2.

This is done in two ways:

<div class="d-flex flex-column flex-md-row flex-items-center flex-md-items-center">
    <div class="col-12 col-md-10 d-flex flex-column flex-justify-center flex-items-center flex-md-items-start pl-md-4">
      <h3 class="text-normal lh-condensed">History File Tracking</h3>
      <p class="h4 color-fg-muted text-normal mb-2">When starting a game, the PS2 writes its game ID to a history file on the current memory card. sd2psXtd tracks the write to this file and detects which game ID has just been written. After that, a game card for this game is mounted and exposed to the PS2.</p>
    </div>
</div>


<div class="d-flex flex-column flex-md-row flex-items-center flex-md-items-center">
    <div class="col-12 col-md-10 d-flex flex-column flex-justify-center flex-items-center flex-md-items-start pl-md-4">
      <h3 class="text-normal lh-condensed">MMCEMAN Game ID</h3>
      <p class="h4 color-fg-muted text-normal mb-2"><strong>MMCEMAN</strong> is a custom IOP module to communicate with Multipurpose Memory Card Emulators. This can be integrated with OPL so OPL can directly send the game ID of a launched game to sd2psx.</p>
    </div>
</div>

## PS2: PS1 Dynamic Mode Selection

When launching in PS2 mode, commands sent to *sd2psx* are monitored. Since PS1 sends controller messages on the same bus as memory card messages, if a controller message is detected, the *sd2psx* switches to PS1 mode.

Firmware 1.5.1 adds experimental switching back to PS2 mode when a PS2 accesses the card after an automatic switch to PS1 mode. This can be used with DKWDRV and Free McBoot.

While in general this should be safe behavior, if *sd2psx* is used mainly in PS1, manual mode selection is recommended.

<div class="d-flex">

{% include toast_warning.liquid %}

If *sd2psx* is connected to a PS1 in PS2 mode, there is **always** a risk of damaging your PS1 console. You have been warned!

{% include toast_warning_end.liquid %}

{% include toast_warning.liquid %}

Do not use *sd2psx* in dynamic mode on a PS1 multitap, as this **WILL damage** your PS1 multitap device.

{% include toast_warning_end.liquid %}

</div>

## PS2: MMCEMAN and MMCEDRV Support

**MMCEMAN** is a PS2 module for interacting with *Multipurpose Memory Card Emulators*. Its main use cases include:

- **Card Switching:** MMCEMMAN can request a card change on *MMCEs*, such as setting a channel or selecting a specific card.
- **Game ID Communication:** MMCEMAN can send a game ID to the *MMCE*, which may in turn switch to a dedicated card for this ID if activated.
- **File System Access:** MMCEMAN allows access to *MMCEs* filesystem through standard POSIX file I/O calls
- **Game loading:** MMCEDRV allows for loading games off of *MMCEs* with performance equal to, or in most cases, better than MX4SIO.

## PS2: Instant Card Availability

If using 8MB cards, *sd2psXtd* firmware exposes the card to the PS2 while it is still being transferred to PSRAM. This enables using FMCB/PS2BBL at boot time without additional waiting scripts.
Very helpful for PlayStation 2 models with simpler OSDSYS programs, that result on faster boot times (like PSX DESR and Arcade PS2)

A new PS2 card created from a [template](#general-template-cards) becomes available after the firmware finishes copying the image.

## PS2: 1-128 MB Card Size Support

Card sizes from 1 to 128 MB are supported. Newly created 1, 2, and 4 MB cards are automatically formatted. Cards larger than 8 MB rely heavily on quick SD card access, so on older or lower-quality SD cards, these larger cards may become corrupt.


{% include toast_note.liquid %}

While the feature has been extensively tested, it is still recommended to use 8MB cards, as this is the official specification for memory cards.

{% include toast_note_end.liquid %}

## PS2: Support for Developer, Arcade and Prototype PS2s

PS2 memory cards have been used in variations of PS2 like: *DevKits*, *TestKits*, *Arcades* and *Prototypes*.

*sd2psXtd* firmware supports these devices by configuring the variant within the PS2 settings.

These PlayStation 2 variations use different magicgate keysets to ensure their memory cards are inaccessible in other devices (e.g., opening a developer memory card on a normal PS2). This is why SD2PSX must actively support them.

{% include toast_note.liquid %}

**Devkit/DTL-H owners**: as you may notice, SD2PSX has no `DEVELOPER` mode, this is because sd2psxtd is mimicking the behavior of licensed retail card. To use the device on developer hardware, set the card to `RETAIL` mode [^1]

{% include toast_note_end.liquid %}

[^1]: Devkits: official retail memory cards use developer magicgate by default until the console actively requests to use retail magicgate with a dedicated command

## PS1: BootCard Mechanics

If BootCard functionality is activated, the PS1 starts with BootCards at startup. If BootCard is not activated, the card index and channel from the previous session are restored automatically.

## PS1: PSRAM Support

*sd2psXtd* firmware allows PS1 cards to be served from PSRAM. While this is mainly an under-the-hood change, it provides more flexibility in RAM usage.


## PS1: Card Switch Controller Combo Support

Controller Button Mapping for Card and Channel Switching

The following button combinations are used to perform card and channel switches:

- L1 + R1 + L2 + R2 + Up: Switch to the Next Card
- L1 + R1 + L2 + R2 + Down: Switch to the Previous Card
- L1 + R1 + L2 + R2 + Right: Switch to the Next Channel
- L1 + R1 + L2 + R2 + Left: Switch to the Previous Channel
- L1 + R1 + L2 + R2 + SELECT: Switch to Boot Card

These mappings require that all four buttons (L1, R1, L2, R2) are held down in combination with one of the directional inputs.

The Controller Combos can be activated by a setting in the PS1 Settings menu.

## PS1: Super fast FreePSXBoot

*sd2psXtd* allows super fast booting of FreePSXBoot by using some non standard card communication.
Please note: This is only possible using a special FreePSXBoot Version provided at https://sd2psXtd.github.io

## PS1: Net Yaroze Support

*sd2psXtd* will act as a Net Yaroze Access Card, if used with the Net Yaroze Software.

## General: USB Modes (1.5.0)

The **USB Mode** submenu on devices with a display offers **Serial**, **PS3 MCA**, and **Mass**. Serial and PS3 MCA are saved across restarts; Mass is a temporary mode.

## General: USB Mass Storage

Select **USB Mode → Mass** or enter `set mode mass` in a USB serial terminal to access the entire microSD card from a computer. The serial command also works on devices without buttons. Mass mode stops card emulation and disables the device buttons. Eject the drive on the computer to return to the previous console mode and USB profile. Idle time, USB suspension, and cable disconnection leave the device in Mass mode. Rebooting returns it to the saved Serial or PS3 MCA profile.

USB re-enumerates on entry and exit, so reopen the serial terminal after switching. While the computer owns the microSD card, CDC accepts only `help` and `version`.

{% include toast_warning.liquid %}

The RP2040 uses USB 1.1 Full Speed, limited to 12 Mbit/s before protocol and SD-card overhead. File transfers are substantially slower than this theoretical limit.

{% include toast_warning_end.liquid %}

## General: USB PS3 Memory Card Adaptor Emulation

Select **USB Mode → PS3 MCA** to present the currently selected PS1 or PS2 card as a Sony PS3 Memory Card Adaptor. Compatible software can access that emulated card over USB. Select the appropriate console mode, card, and channel using the device controls.

On devices without a display, set `MCA=ON` in the `[General]` section of `.sd2psx/settings.ini`, or enter `set mode mca` through USB-CDC. The serial interface disconnects when MCA starts. Return to **USB Mode → Serial**, or set `MCA=OFF` on the SD card and restart, to use CDC again.

MCA exposes the selected memory card; Mass exposes the entire microSD card.

## General: USB-CDC Command Interface

In **Serial** mode, the device exposes a USB-CDC serial interface that accepts simple text commands. This can be used to change cards, channels, modes, PS2 variants, or to reboot the device without using the on-device controls.

Commands are lowercase and submitted with Enter:

```text
help
version
ls [path]
stat <path>
reset bl
reset dev
channel up
channel down
set channel <idx>
card up
card down
set card <idx> [channel <idx>]
set game <id> [channel <idx>]
set mode <ps1|ps2|mca|mass>
set variant <retail|proto|conquest|arcade>
```

`reset bl` resets to the bootloader. `reset dev` restarts the firmware. Card, channel, and game commands affect the currently active mode. Setting a PS2 variant also switches the device to PS2 mode.

{% include toast_note.liquid %}

Both normal and debug builds accept USB-CDC commands and report command output. Debug builds also send firmware logs over USB serial. `set mode mca` disconnects CDC and starts PS3 MCA emulation.

{% include toast_note_end.liquid %}

## General: SD Card Layouts

The firmware supports MBR and GPT partition tables as well as superfloppy layouts, where the filesystem is directly on the card with no partition table.

## General: Settings File

*sd2psXtd* generates a settings file (`.sd2psx/settings.ini`) that allows you to edit some settings through your computer. This is useful when using one SD card with multiple *sd2psx* devices or *MMCE* devices without a display to change settings.

A settings file has the following format:

```ini
[General]
Mode=PS2
FlippedScreen=OFF
MCA=OFF
[PS1]
Autoboot=ON
GameID=ON
EnableControllerCombo=ON
MaxCardIdx=0
MaxChannels=8
[PS2]
Autoboot=ON
GameID=ON
CardSize=16
Variant=RETAIL
MaxCardIdx=0
MaxChannels=8
```

Possible values are:

| Setting       | Values                                |
|---------------|---------------------------------------|
| Mode          | `PS1`, `PS2`                          |
| Autoboot      | `OFF`, `ON`                           |
| GameID        | `OFF`, `ON`                           |
| CardSize      | `1`, `2`, `4`, `8`, `16`, `32`, `64`, `128` |
| Variant       | `RETAIL`, `PROTO`, `ARCADE`, `CONQUEST`     |
| FlippedScreen | `ON`, `OFF`                           |
| MCA           | `ON`, `OFF`                           |
| EnableControllerCombo | `ON`, `OFF`                   |
| MaxCardIdx    | `1`–`255`; `0` means unlimited        |
| MaxChannels   | `1`–`255`                             |

`MCA=ON` selects PS3 MCA; `MCA=OFF` selects Serial. Mass storage is temporary and is not saved in this setting.

Set `MaxCardIdx` and `MaxChannels` separately in `[PS1]` and `[PS2]`. `MaxChannels` defaults to 8 and can be overridden per card. `MaxCardIdx=0` is the default unlimited setting; the parser only applies positive values, so entering `0` does not clear an existing limit.

*Note: Make sure there is an empty line at the end of the ini file.*

## General: Support for Other RP2040-Based MMCE Devices

Support for different MMCE devices that share the same MCU has been added:

- **PicoMemcard+/PicoMemcardZero:** DIY devices by dangiu (see [here](https://github.com/dangiu/PicoMemcard?tab=readme-ov-file#picomemcard-using-memory-card)) without PSRAM. Use *PMC+* or *PMCZero* firmware variant.
- **PSXMemCard:** A commercial device by BitFunX sharing the same architecture as *PMC+*. Use *psxmemcard* firmware variant.
- **PSXMemCard Gen2:** A commercial device by BitFunX, sharing the same architecture as *sd2psx*. Use *sd2psx* firmware variant.

For each device, follow the flashing instructions provided by the creator, using the corresponding *sd2psXtd* firmware file.


*New in 1.2*:
PMC+ and PMCZero now support using the onboard buttons. They are assigned in the following way (according to the markings ons their board):

- **Button 1**: Load BootCard
- **Button 2**:
  - Short Press: Previous Channel
  - Long Press: Previous Card
- **Button 3**:
  - Short Press: Next Channel
  - Long Press: Next Card


## General: Per Card Config

There are some configuration values that can be modified on a per card base within a config file named  `CardX.ini` in a card folder, where `X` is the card index.

*Note 1: The `CardSize` setting is only used for PS2 cards and can only be either of `1`, `2`, `4`, `8`, `16`, `32`, `64`, `128`.*
*Note 2: The BOOT folder should contain a file named `BootCard.ini`*
*Note 3: Make sure there is an empty line at the end of the ini file.*

`MaxChannels` accepts `1`–`255` and overrides the default for the current PS1 or PS2 mode.

```ini
[ChannelName]
1=Channel 1 Name
2=Channel 2 Name
3=Channel 3 Name
4=Channel 4 Name
5=Channel 5 Name
6=Channel 6 Name
7=Channel 7 Name
8=Channel 8 Name
[Settings]
MaxChannels=8
CardSize=8
```

## General: Template Cards

To give new memory cards a set of starting saves or tools, copy a raw `.mcd` image from `MemoryCards` to the `.sd2psx` folder at the root of the microSD card.

| Mode | Template file | Required size |
| --- | --- | --- |
| PS1 | `.sd2psx/ps1.mcd` | 128 KB (131,072 bytes) |
| PS2 | `.sd2psx/ps2.mcd` | A supported PS2 card size, such as 8 MB (8,388,608 bytes) |

The firmware uses the template when creating a numbered card, channel, Game ID card, or BootCard. It also uses the template when recreating a PS2 card with an invalid image size. The PS2 template's size takes precedence over `CardSize` in the device and per-card settings. An invalid template size falls back to an empty card.

[Template formats and behavior](https://github.com/sd2psXtd/firmware/blob/{{ site.firmware_version }}/doc/configuration.md#general-template-cards)

## General: Game2Folder mapping

There are some games, that share save data for multiple game ids (like the Singstar series etc). For these cases, a custom game to folder mapping can be created.

If a game with a mapped id is loaded, instead of using the game id based folder, the mapped folder is used for storing the card.

The mapping needs to be defined in ```.sd2psx/Game2Folder.ini``` in the following way:

```ini
[PS1]
SCXS-12345=FolderName1
[PS2]
SCXS-23456=FolderName2
```

{% include toast_note.liquid %}

Be aware: Long folder names may not be displayed correctly and may result in stuttering of MMCE games due to scrolling.

{% include toast_note_end.liquid %}

*Note 2: Make sure there is an empty line at the end of the ini file.*

## General: Splash Screen (1.3)

By default, sd2psXtd comes with a special splash screen resembling the project's logo.

You can customize this by going to the [splashgen page](/splashgen/splashgen.html) on the project website!

From there, you can customize a splash screen to your needs. Once you are happy with the result displayed in the preview, press the **Download UF2** button. This will generate a UF2 file containing your splash screen.

You can flash this splash screen just like any other firmware update.

Alternatively, place a generated `splash.bin` in the root of the SD card. On startup, the firmware imports it into flash and removes `splash.bin` from the SD card.

The flashed splash screen is maintained after a firmware update, so you probably only need to upload it once.

*Note: When combining the splash screen with a firmware UF2 (such as for mass production or flashing multiple sd2psXtd with the same splash and firmware combination), it's strongly recommended to flash the combined image with `picotool`, since uploading using the usual firmware update procedure often does not work. To do so, please install `picotool` and run:*

```sh
picotool load <combined_file_name>.uf2
```

*while having the sd2psx to be updated connected in bootloader mode.*

## General: Game Image Screen (1.3)

Add a splash image that the device shows in the card main view. Use the [splashgen page](/splashgen/splashgen.html) to convert a source image to the device `.bin` format, then place the generated file in the card folder on your SD card.

Naming and behavior:

- Folder-level splash (default for the folder):
    - Path: `MemoryCards/<Variant>/<card_folder>/<card_folder>.bin`
    - Example: `MemoryCards/<Variant>/SuperGame/SuperGame.bin` — used when no channel-specific image exists.
- Channel-specific splash (overrides folder-level for that channel):
    - Path: `MemoryCards/<Variant>/<card_folder>/<card_folder>-<channel_number>.bin`
    - Example: `MemoryCards/<Variant>/SuperGame/SuperGame-1.bin` — shown only for channel 1 of that card folder.
- Fallback rules:
    - If a channel-specific file exists it is used.
    - Otherwise the folder-level `<card_folder>.bin` is used.
    - If neither exists, no splash is shown.

Practical notes
- `<channel_number>` matches the on-device channel index (1..N).
- Filenames must match exactly; FAT SD cards are usually case-insensitive but keep names consistent.
- Use the [splashgen tool](/splashgen/splashgen.html) to produce correctly-sized and packed `.bin` files for the OLED.
- Keep names short — very long filenames may cause display or performance issues.
- Store splash `.bin` files alongside that card's `CardX.ini` and save data in the same folder.

## Special Thanks to...

- **@xyz**: for sd2psx ❤️
- **sd2psXtd Team**: (you know who you are 😉 )
- **@El_isra**: for so much different stuff ❤️
- **@Berion**: Our new beautiful logo ❤️
- **8BitMods Team**: for helping out with card formatting and providing lots of other useful information ❤️
- **@Mena / PhenomMods**: for providing hardware to some team members ❤️
- **BitFunX**: for providing PSXMemcard and PSXMemcard Gen2 Hardware for dev ❤️
- **@mathewbeall**: for arcade fixes ❤️
- **@wark**: for USB mass storage inspiration ❤️
- **@max-las**: for SD-related fixes ❤️
- **All Testers**: ripto, Vapor, seewood, john3d, rippenbiest, ... ❤️
- **@niemasd**: for [GameDB-PSX](https://github.com/niemasd/GameDB-PSX), used for PS1 game names and IDs ❤️
