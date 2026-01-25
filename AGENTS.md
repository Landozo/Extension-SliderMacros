# AGENTS.md

## Project Overview

**Slider Macros** is a SillyTavern extension that adds customizable sliders for user macros in Chat Completion settings. Forked from the CustomSliders Extension by Cohee1207.

- **Type**: SillyTavern third-party extension
- **Language**: TypeScript
- **Build System**: Webpack
- **License**: AGPL-3.0

## Commands

```bash
# Install dependencies
npm install

# Build for production (outputs to dist/)
npm run build

# Lint code
npm run lint

# Lint and auto-fix
npm run lint:fix
```

## Project Structure

```
Extension-SliderMacros/
├── src/
│   ├── index.ts          # Main entry point - all extension logic
│   ├── settings.html     # Settings panel HTML template
│   ├── config.html       # Individual slider config HTML template
│   ├── slider.html       # Slider UI element template
│   ├── style.css         # Component styles
│   └── html.d.ts         # TypeScript declaration for HTML imports
├── dist/                 # Build output (generated)
│   └── index.js          # Bundled output referenced by manifest
├── globals.d.ts          # Global SillyTavern type declarations
├── manifest.json         # SillyTavern extension manifest
├── webpack.config.js     # Webpack configuration
├── tsconfig.json         # TypeScript configuration
└── eslint.config.mjs     # ESLint flat config
```

## Architecture

### Entry Point
All extension logic is in `src/index.ts` - a single-file architecture with:

1. **Interfaces**: `SliderModel`, `SliderCollection`, `ExtensionSettings`
2. **Settings Management**: `getSettings()` handles initialization and defaults
3. **UI Rendering**: `addSettingsControls()`, `renderSliderConfigs()`, `renderCompletionSliders()`
4. **Event Handlers**: Collection management, import/export, preset binding
5. **Macro Registration**: `updateSliderMacros()` registers sliders with SillyTavern's macro system

### SillyTavern Integration
The extension uses `SillyTavern.getContext()` to access:
- `saveSettingsDebounced` - Save settings
- `eventSource`, `event_types` - Event system
- `chatCompletionSettings` - Chat completion configuration
- `Popup` - Modal dialogs
- `powerUserSettings` - Power user features
- `macros`, `MacrosParser` - Macro registration

### Slider Types
1. **Numeric**: Standard range slider with min/max/step
2. **Boolean**: Two-position slider (True/False)
3. **MultiSelect**: Discrete options slider (2-4 options)

### HTML Templates
Templates are imported as strings via `html-loader` and rendered using `<template>` elements:
```typescript
import settingsTemplate from './settings.html';
const renderer = document.createElement('template');
renderer.innerHTML = settingsTemplate;
```

## Code Style

### ESLint Rules (Enforced)
- **Indentation**: 4 spaces
- **Quotes**: Single quotes
- **Semicolons**: Required
- **Trailing commas**: Required in multiline
- **Object spacing**: `{ key: value }` (spaces inside braces)
- **EOL**: Newline at end of file
- **No trailing spaces**

### TypeScript
- **Target**: ES6
- **Module**: ESNext with Bundler resolution
- **Strict mode**: Enabled

### Naming Conventions
- Functions: `camelCase` (e.g., `getSettings`, `renderSliderConfigs`)
- Interfaces: `PascalCase` (e.g., `SliderModel`, `ExtensionSettings`)
- Constants: `UPPER_SNAKE_CASE` for IDs (e.g., `MODULE_NAME`, `CONTAINER_ID`)
- HTML element IDs: `snake_case` (e.g., `slider_macros_list`)
- CSS classes: `snake_case` or `camelCase` matching SillyTavern patterns

### Patterns

**Event Listeners**: Attach to elements after template rendering
```typescript
elements.create.addEventListener('click', createSlider);
```

**Settings Access**: Always use `getSettings()` which ensures defaults exist
```typescript
const settings = getSettings();
const activeCollection = settings.collections.find(c => c.active);
```

**DOM Queries**: Use `as HTMLElement` type assertions after queries
```typescript
const input = renderer.content.querySelector('input[name="name"]') as HTMLInputElement;
```

**Saving**: Use debounced save after any settings change
```typescript
slider.value = parseFloat(sliderInput.value);
saveSettingsDebounced();
```

## Build Configuration

### Webpack
- Entry: `src/index.ts`
- Output: `dist/index.js`
- Loaders: `ts-loader`, `css-loader`, `style-loader`, `html-loader`
- CSS is injected via `style-loader` (no separate CSS file)
- Terser minification with comments stripped

### Path Aliases
```javascript
alias: {
    '/scripts': '../../../../scripts',
    '/script.js': '../../../../script.js',
}
```
These resolve to SillyTavern's root when extension is installed in `data/default-user/extensions/`.

## Extension Manifest

```json
{
    "display_name": "Slider Macros",
    "js": "dist/index.js",
    "css": ""
}
```
The extension loads only JavaScript; CSS is bundled into JS via webpack.

## Important Gotchas

1. **jQuery Dependency**: SillyTavern provides jQuery globally. Events sometimes need both native and jQuery handlers:
   ```typescript
   sliderInput.addEventListener('input', inputEventListener);
   $(sliderInput).on('input', inputEventListener);
   ```

2. **Macro Engine Compatibility**: Two code paths for macro registration:
   - New: `macros.register()` (experimental engine)
   - Legacy: `MacrosParser.registerMacro()`

3. **Boolean Slider Inversion**: UI value is inverted from stored value (True=left/0, False=right/1)

4. **Global Types**: `globals.d.ts` imports SillyTavern's global types from parent directories. The extension expects to be installed in the SillyTavern extensions directory.

5. **No Tests**: No test framework is configured. Test manually in SillyTavern.

6. **YAML Parsing**: The `yaml` package is used for parsing YAML strings (see `mergeYamlIntoObject`).

## Development Workflow

1. Install extension in SillyTavern's `data/default-user/extensions/third-party/` directory
2. Run `npm install` then `npm run build`
3. Reload SillyTavern to see changes
4. Extension settings appear in the Extensions panel
5. Sliders render in Chat Completion settings panel
