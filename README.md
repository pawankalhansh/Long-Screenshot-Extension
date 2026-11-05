# Long Screenshot for Chrome / Edge

A premium Manifest V3 extension to capture full-page, visible, and specific area screenshots. Features a modern, Edge-inspired floating toolbar overlay.

## Features
- **Capture Scroll Box (Interactive Window Selector)**: Click any internal scrolling container (e.g. Google Search AI Overview chat, Twitter/X threads, ChatGPT, Claude, Discord, sidebars) and automatically capture its entire scrolling history from top to bottom!
- **Twitter & Infinite-Feed Support**: Optimized scrolling engine with dynamic render wait, synthetic event dispatch, and auto-expanding canvas for virtualized feeds like Twitter/X.
- **Smart Internal Scroll Detection**: Automatically detects and captures internal scrolling containers, not just the main window.
- **Capture Area**: Drag and select any part of a webpage to capture.
- **Capture Visible**: Instantly captures what you currently see on your screen.
- **Capture Full Page**: Automatically scrolls through the entire webpage and seamlessly stitches it into one continuous image.
- **Copy to Clipboard**: Easily copy the captured screenshot directly to your clipboard to paste in chats, docs, or emails.
- **Save as PNG or JPG**: Download the captured images in your preferred format.
- **Built-in Annotation & OCR**: Annotate, draw shapes, crop, and extract text from images via offline Tesseract OCR.
- **Keyboard Shortcuts & Esc Support**: Trigger instantly with `Alt + Shift + S` (Windows) or `Cmd + Shift + S` (Mac), and hit `Esc` anytime to cancel!

## Installation (Developer Mode)
1. Open Google Chrome or Microsoft Edge.
2. Go to `chrome://extensions/` (or `edge://extensions/`).
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** in the top left.
5. Select this extension's folder (`D:\Coding Project\Long Screenshot`).

## Usage
- Click the extension icon in your browser toolbar, OR
- Press `Alt + Shift + S` (Windows) or `Cmd + Shift + S` (Mac) while on any webpage to open the capture toolbar.
- Choose your capture mode:
  - **Capture area**: Drag to select an exact region.
  - **Capture visible**: Take a snapshot of the visible viewport.
  - **Capture scroll box**: Hover over any chat window (like Google Search AI Overview or a Twitter thread) and click to capture the entire scroll box.
  - **Capture full page**: Scroll and capture the whole webpage or timeline.
- Press `Esc` anytime to cancel or close the toolbar / capture overlay.

## Troubleshooting Keyboard Shortcuts
If the shortcut does not trigger automatically on your browser:
1. Open `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`).
2. Find **Long Screenshot**.
3. If the shortcut field is blank, another extension or system shortcut had already reserved `Alt + Shift + S`. Click the edit pencil icon and type your preferred key combination (e.g. `Alt + Shift + S` or `Ctrl + Shift + S`).
4. Note that shortcuts cannot run on restricted browser pages (such as `chrome://` settings or Chrome Web Store pages). When on such pages, the extension badge will show `N/A`.
