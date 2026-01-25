/** Central Imports - Will make them a dedicated file later for cleanliness */

import yaml from 'yaml';
import './style.css';
import settingsTemplate from './settings.html';
import configTemplate from './config.html';
import sliderTemplate from './slider.html';
// import { macros, MacroCategory } from '../../../../macros/macro-system.js';
// import { MacrosParser } from '../../../../macros.js';
// import { MacroCategory } from '../../../../macros/engine/MacroRegistry';

const { saveSettingsDebounced, event_types, eventSource, chatCompletionSettings, Popup, powerUserSettings: power_user, macros, MacrosParser } = (SillyTavern.getContext() as any);

const MODULE_NAME = 'sliderMacros';
const DEBOUNCE_DELAY = 300;

// Local debounce utility for text inputs
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return ((...args: unknown[]) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delay);
    }) as T;
}

// Debounced versions for text input handlers
const debouncedSaveSettings = debounce(() => saveSettingsDebounced(), DEBOUNCE_DELAY);
const createDebouncedRender = (settings: ExtensionSettings) => debounce(() => renderCompletionSliders(settings), DEBOUNCE_DELAY);

interface ChatCompletionRequestData {
    chat_completion_source: string;
    custom_include_body: string;
}

interface SliderModel {
    name: string;
    property: string;
    type: string;
    min: string;
    max: string;
    step: string;
    value: number;
    enabled: boolean;
    options: string[];
}

interface SliderCollection {
    active: boolean;
    name: string;
    sliders: SliderModel[];
    presets: string[];
}

interface ExtensionSettings {
    collections: SliderCollection[];
    // Allow additional properties
    [key: string]: unknown;
}

interface GlobalSettings {
    [MODULE_NAME]: ExtensionSettings;
}

const defaultSettings: Readonly<ExtensionSettings> = Object.freeze({
    collections: [{
        active: true,
        name: 'Default',
        sliders: [],
        presets: [],
    }],
});

export function getSettings(): ExtensionSettings {
    const context = SillyTavern.getContext();
    const globalSettings = context.extensionSettings as object as GlobalSettings;

    // Initialize settings if they don't exist
    if (!globalSettings[MODULE_NAME]) {
        globalSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key in defaultSettings) {
        if (globalSettings[MODULE_NAME][key] === undefined) {
            globalSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    const settings = globalSettings[MODULE_NAME];

    // Ensure at least one collection exists
    if (settings.collections.length === 0) {
        settings.collections.push(defaultSettings.collections[0]);
    }

    // Ensure at least one active collection
    if (!settings.collections.some(c => c.active)) {
        settings.collections[0].active = true;
    }

    return settings;
}

function getUIElements() {
    return {
        create: document.getElementById('slider_macros_create') as HTMLInputElement,
        list: document.getElementById('slider_macros_list') as HTMLDivElement,
        rangeBlock: document.getElementById('range_block_openai') as HTMLDivElement,
        collections: document.getElementById('slider_macros_collections') as HTMLSelectElement,
        createCollection: document.getElementById('slider_macros_create_collection') as HTMLDivElement,
        deleteCollection: document.getElementById('slider_macros_delete_collection') as HTMLDivElement,
        bindToPreset: document.getElementById('slider_macros_bind_to_preset') as HTMLDivElement,
        hint: document.getElementById('slider_macros_hint') as HTMLDivElement,
        importFile: document.getElementById('slider_macros_import_file') as HTMLInputElement,
        importCollection: document.getElementById('slider_macros_import_collection') as HTMLDivElement,
        exportCollection: document.getElementById('slider_macros_export_collection') as HTMLDivElement,
    };
}

export function addSettingsControls(settings: ExtensionSettings): void {
    const settingsContainer = document.getElementById('slider_macros_container') ?? document.getElementById('extensions_settings');
    if (!settingsContainer) {
        return;
    }

    const renderer = document.createElement('template');
    renderer.innerHTML = settingsTemplate;

    settingsContainer.appendChild(renderer.content);

    const elements = getUIElements();
    elements.create.addEventListener('click', createSlider);
    elements.createCollection.addEventListener('click', createCollection);
    elements.deleteCollection.addEventListener('click', deleteCollection);
    elements.bindToPreset.addEventListener('click', bindToPreset);
    elements.collections.addEventListener('change', (e) => {
        const selectedName = elements.collections.value;
        settings.collections.forEach((collection) => {
            collection.active = collection.name === selectedName;
        });
        saveSettingsDebounced();
        renderSliderConfigs(settings);
    });
    elements.importCollection.addEventListener('click', async () => {
        elements.importFile.click();
    });
    elements.exportCollection.addEventListener('click', async () => {
        const activeCollection = settings.collections.find(c => c.active);
        if (!activeCollection) {
            return;
        }
        const fileName = activeCollection.name + '.json';
        const fileContent = JSON.stringify(activeCollection.sliders, null, 4);
        const blob = new Blob([fileContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    });
    elements.importFile.addEventListener('change', (e) => {
        const file = elements.importFile.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileName = file.name.split('.').shift() || 'imported';
                const fileContent = event.target?.result as string;
                const parsedSliders = JSON.parse(fileContent) as SliderModel[];
                if (!Array.isArray(parsedSliders)) {
                    toastr.error('Invalid JSON file format.');
                    return;
                }
                processImport(fileName, parsedSliders, settings);
            } catch {
                toastr.error('Failed to parse JSON file.');
                return;
            }
        };
        reader.readAsText(file);
        elements.importFile.value = '';
    });
}

async function processImport(fileName: string, parsedSliders: SliderModel[], settings: ExtensionSettings): Promise<void> {
    const newName = await Popup.show.input('Import Collection', 'Enter the name of the new collection:', fileName);
    if (!newName) {
        return;
    }

    const existingCollection = settings.collections.find(c => c.name === newName);
    if (existingCollection) {
        toastr.warning('Collection with this name already exists.');
        return;
    }

    const newCollection: SliderCollection = {
        active: true,
        name: newName,
        sliders: parsedSliders,
        presets: [],
    };

    settings.collections.forEach((collection) => {
        collection.active = false;
    });
    settings.collections.push(newCollection);
    saveSettingsDebounced();
    renderSliderConfigs(settings);
    toastr.success(`Imported ${parsedSliders.length} sliders into collection "${newName}".`);
}

async function deleteCollection(): Promise<void> {
    const settings = getSettings();
    if (settings.collections.length === 1) {
        toastr.warning('Cannot delete the last collection.');
        return;
    }
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    const confirm = await Popup.show.confirm('Delete Collection', `Are you sure you want to delete the collection "${activeCollection.name}"?`);
    if (!confirm) {
        return;
    }
    const collectionIndex = settings.collections.indexOf(activeCollection);
    settings.collections.splice(collectionIndex, 1);
    const firstCollection = settings.collections[0];
    if (firstCollection) {
        firstCollection.active = true;
    }
    saveSettingsDebounced();
    renderSliderConfigs(settings);
}

async function createCollection(): Promise<void> {
    const settings = getSettings();
    const name = await Popup.show.input('New Collection Name', 'Enter the name of the new collection:');
    if (!name) {
        return;
    }
    const existingCollection = settings.collections.find(c => c.name === name);
    if (existingCollection) {
        toastr.warning('Collection with this name already exists.');
        return;
    }
    settings.collections.forEach((collection) => {
        collection.active = false;
    });
    settings.collections.push({
        active: true,
        name,
        sliders: [],
        presets: [],
    });
    saveSettingsDebounced();
    renderSliderConfigs(settings);
}

// This function is used to bind the active collection to a preset.
function bindToPreset(): void {
    const settings = getSettings();
    const presetName = chatCompletionSettings.preset_settings_openai;
    if (!presetName) {
        toastr.warning('No Chat Completion preset selected.');
        return;
    }
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    const collectionWithPreset = settings.collections.find(c => c.presets.includes(presetName));
    if (collectionWithPreset) {
        collectionWithPreset.presets.splice(collectionWithPreset.presets.indexOf(presetName), 1);
        if (collectionWithPreset !== activeCollection) {
            toastr.warning(`The preset will be unbound from another collection "${collectionWithPreset.name}".`);
            activeCollection.presets.push(presetName);
        }
    } else {
        activeCollection.presets.push(presetName);
        toastr.info(`Selecting the preset "${presetName}" will now automatically pick the sliders collection "${activeCollection.name}".`);
    }

    saveSettingsDebounced();
    renderSliderConfigs(settings);
}

// This function is used to create a new slider from the settings panel.
function createSlider(): void {
    const settings = getSettings();
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    activeCollection.sliders.unshift({
        name: 'New Slider',
        property: '',
        type: 'Numeric',
        min: '0',
        max: '1',
        step: '0.01',
        value: 0,
        enabled: true,
        options: [],
    });

    renderSliderConfigs(settings);
}


// This function is used to render the slider options in the settings panel.
function renderSliderConfigs(settings: ExtensionSettings): void {
    const elements = getUIElements();
    const debouncedRender = createDebouncedRender(settings);

    elements.list.innerHTML = '';
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    elements.collections.innerHTML = '';
    settings.collections.forEach((collection) => {
        const option = document.createElement('option');
        option.value = collection.name;
        option.textContent = collection.name;
        option.selected = collection.active;
        elements.collections.appendChild(option);
    });
    const presetName = chatCompletionSettings.preset_settings_openai;
    elements.bindToPreset.classList.toggle('toggleEnabled', activeCollection.presets.includes(presetName));
    activeCollection.sliders.forEach((slider, index) => {
        const renderer = document.createElement('template');
        renderer.innerHTML = configTemplate;

        const card = renderer.content.querySelector('.slider_macros_card') as HTMLDivElement;
        const cardHeader = renderer.content.querySelector('.slider_macros_card_header') as HTMLDivElement;
        const cardNameDisplay = renderer.content.querySelector('.slider_macros_card_name') as HTMLSpanElement;
        const cardMacroDisplay = renderer.content.querySelector('.slider_macros_card_macro') as HTMLSpanElement;
        const cardTypeBadge = renderer.content.querySelector('.slider_macros_card_type_badge') as HTMLSpanElement;

        const nameInput = renderer.content.querySelector('input[name="name"]') as HTMLInputElement;
        const propertyInput = renderer.content.querySelector('input[name="property"]') as HTMLInputElement;
        const minInput = renderer.content.querySelector('input[name="min"]') as HTMLInputElement;
        const maxInput = renderer.content.querySelector('input[name="max"]') as HTMLInputElement;
        const stepInput = renderer.content.querySelector('input[name="step"]') as HTMLInputElement;
        const enableCheckbox = renderer.content.querySelector('input[name="enabled"]') as HTMLInputElement;
        const typeSelect = renderer.content.querySelector('select[name="type"]') as HTMLSelectElement;

        const deleteButton = renderer.content.querySelector('button[name="delete"]') as HTMLButtonElement;
        const upButton = renderer.content.querySelector('button[name="up"]') as HTMLButtonElement;
        const downButton = renderer.content.querySelector('button[name="down"]') as HTMLButtonElement;

        const numericOnly = renderer.content.querySelector('.numeric-only') as HTMLElement;
        const booleanOnly = renderer.content.querySelector('.boolean-only') as HTMLElement;
        const multiSelectOnly = renderer.content.querySelector('.multiselect-only') as HTMLElement;

        // Set initial values
        nameInput.value = slider.name;
        propertyInput.value = slider.property;
        minInput.value = slider.min;
        maxInput.value = slider.max;
        stepInput.value = slider.step;
        enableCheckbox.checked = slider.enabled;
        typeSelect.value = slider.type || 'Numeric';

        // Update card header display
        cardNameDisplay.textContent = slider.name || 'New Slider';
        cardMacroDisplay.textContent = slider.property || '';
        cardTypeBadge.textContent = slider.type || 'Numeric';

        // Update card visual state based on enabled
        if (!slider.enabled) {
            card.dataset.disabled = 'true';
        }

        // Expand/collapse toggle - click on header (excluding controls)
        cardHeader.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // Don't toggle if clicking on controls (checkbox, buttons)
            if (target.closest('.slider_macros_card_controls')) {
                return;
            }
            const isExpanded = card.dataset.expanded === 'true';
            card.dataset.expanded = isExpanded ? 'false' : 'true';
        });

        // MultiSelect Inputs
        const optionInputs = [
            renderer.content.querySelector('input[name="option1"]') as HTMLInputElement,
            renderer.content.querySelector('input[name="option2"]') as HTMLInputElement,
            renderer.content.querySelector('input[name="option3"]') as HTMLInputElement,
            renderer.content.querySelector('input[name="option4"]') as HTMLInputElement,
        ];

        if (!slider.options) {
            slider.options = ['', '', '', ''];
        }

        // Fill option inputs
        optionInputs.forEach((input, i) => {
            if (input) {
                input.value = slider.options[i] || '';
                input.addEventListener('input', () => {
                    slider.options[i] = input.value;
                    // Ensure options array matches inputs
                    debouncedRender();
                    debouncedSaveSettings();
                });
            }
        });

        // Visibility toggle function for this specific slider instance
        const updateVisibility = () => {
            const type = typeSelect.value;
            if (numericOnly) numericOnly.style.display = type === 'Numeric' ? 'block' : 'none';
            if (booleanOnly) booleanOnly.style.display = type === 'Boolean' ? 'block' : 'none';
            if (multiSelectOnly) multiSelectOnly.style.display = type === 'MultiSelect' ? 'block' : 'none';
        };

        // Initial update
        updateVisibility();

        // Event listener for type change
        typeSelect.addEventListener('change', () => {
            slider.type = typeSelect.value;
            cardTypeBadge.textContent = slider.type;
            updateVisibility();
            saveSettingsDebounced();
            // Re-render sliders to reflect type change in the main UI
            renderCompletionSliders(settings);
        });

        nameInput.addEventListener('input', (e) => {
            slider.name = nameInput.value;
            cardNameDisplay.textContent = slider.name || 'New Slider';
            debouncedRender();
            debouncedSaveSettings();
        });

        propertyInput.addEventListener('input', (e) => {
            slider.property = propertyInput.value;
            cardMacroDisplay.textContent = slider.property || '';
            debouncedRender();
            debouncedSaveSettings();
        });

        minInput.addEventListener('input', (e) => {
            slider.min = minInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        maxInput.addEventListener('input', (e) => {
            slider.max = maxInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        stepInput.addEventListener('input', (e) => {
            slider.step = stepInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        enableCheckbox.addEventListener('change', (e) => {
            slider.enabled = enableCheckbox.checked;
            card.dataset.disabled = slider.enabled ? 'false' : 'true';
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        deleteButton.addEventListener('click', async () => {
            const confirm = await Popup.show.confirm('Delete Slider', `Are you sure you want to delete the slider "${slider.name}"?`);
            if (!confirm) {
                return;
            }

            const activeCollection = settings.collections.find(c => c.active);
            if (!activeCollection) {
                return;
            }
            activeCollection.sliders.splice(index, 1);
            renderSliderConfigs(settings);
            saveSettingsDebounced();
        });

        upButton.addEventListener('click', () => {
            if (index > 0) {
                const activeCollection = settings.collections.find(c => c.active);
                if (!activeCollection) {
                    return;
                }
                const temp = activeCollection.sliders[index - 1];
                activeCollection.sliders[index - 1] = activeCollection.sliders[index];
                activeCollection.sliders[index] = temp;
                renderSliderConfigs(settings);
                saveSettingsDebounced();
            }
        });

        downButton.addEventListener('click', () => {
            const activeCollection = settings.collections.find(c => c.active);
            if (!activeCollection) {
                return;
            }
            if (index < activeCollection.sliders.length - 1) {
                const temp = activeCollection.sliders[index + 1];
                activeCollection.sliders[index + 1] = activeCollection.sliders[index];
                activeCollection.sliders[index] = temp;
                renderSliderConfigs(settings);
                saveSettingsDebounced();
            }
        });

        elements.list.appendChild(renderer.content);
    });

    if (activeCollection.sliders.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.classList.add('empty-message');
        emptyMessage.textContent = 'No custom sliders. Click "Create" to add one.';
        elements.list.appendChild(emptyMessage);
    }

    renderCompletionSliders(settings);
    // renderHint();
}


// This function is used to render the sliders in the completion settings. It is called when the settings are loaded and when a new slider is created.
function renderCompletionSliders(settings: ExtensionSettings): void {
    const elements = getUIElements();
    const DRAWER_ID = 'slider_macros_drawer';
    const CONTAINER_ID = 'slider_macros_main_container';
    const COLLECTION_SELECT_ID = 'slider_macros_completion_collections';
    const CONTENT_ID = 'slider_macros_drawer_content';

    let drawer = document.getElementById(DRAWER_ID) as HTMLDivElement;
    let container = document.getElementById(CONTAINER_ID) as HTMLDivElement;

    // Check if we need to create the drawer structure
    if (!drawer) {
        // Create the inline-drawer wrapper
        drawer = document.createElement('div');
        drawer.id = DRAWER_ID;
        drawer.className = 'inline-drawer m-t-1 wide100p';

        // Create drawer header with toggle
        const drawerHeader = document.createElement('div');
        drawerHeader.className = 'inline-drawer-toggle inline-drawer-header';

        const drawerTitle = document.createElement('b');
        drawerTitle.textContent = 'Custom Sliders';
        drawerHeader.appendChild(drawerTitle);

        const drawerIcon = document.createElement('div');
        drawerIcon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
        drawerHeader.appendChild(drawerIcon);

        drawer.appendChild(drawerHeader);

        // Create drawer content
        const drawerContent = document.createElement('div');
        drawerContent.id = CONTENT_ID;
        drawerContent.className = 'inline-drawer-content';

        // Create collection selector row
        const collectionRow = document.createElement('div');
        collectionRow.className = 'flex-container m-b-1';

        const collectionLabel = document.createElement('span');
        collectionLabel.textContent = 'Collection:';
        collectionLabel.className = 'flex0';
        collectionLabel.style.marginRight = '10px';
        collectionRow.appendChild(collectionLabel);

        const collectionSelect = document.createElement('select');
        collectionSelect.id = COLLECTION_SELECT_ID;
        collectionSelect.className = 'text_pole flex1';
        collectionSelect.addEventListener('change', () => {
            const selectedName = collectionSelect.value;
            settings.collections.forEach((collection) => {
                collection.active = collection.name === selectedName;
            });
            saveSettingsDebounced();
            renderSliderConfigs(settings);
        });
        collectionRow.appendChild(collectionSelect);

        drawerContent.appendChild(collectionRow);

        // Check if container already exists (pre-existing), wrap it; otherwise create new
        if (container) {
            // Move existing container into drawer content
            drawerContent.appendChild(container);
            // Insert drawer where container was
            container.parentNode?.insertBefore(drawer, container);
            drawer.appendChild(drawerHeader);
            drawer.appendChild(drawerContent);
        } else {
            // Create new container
            container = document.createElement('div');
            container.id = CONTAINER_ID;
            container.className = 'slider_macros_container';
            drawerContent.appendChild(container);

            drawer.appendChild(drawerContent);

            // Try to insert after the last standard slider
            const rangeBlocks = Array.from(elements.rangeBlock.querySelectorAll('.range-block'));
            const lastRangeBlock = rangeBlocks.pop();

            if (lastRangeBlock) {
                lastRangeBlock.insertAdjacentElement('afterend', drawer);
            } else {
                // Fallback: just append to the main block
                elements.rangeBlock.appendChild(drawer);
            }
        }
    }

    // Refresh references after potential DOM changes
    container = document.getElementById(CONTAINER_ID) as HTMLDivElement;
    const collectionSelect = document.getElementById(COLLECTION_SELECT_ID) as HTMLSelectElement;

    // Populate collection dropdown
    collectionSelect.innerHTML = '';
    settings.collections.forEach((collection) => {
        const option = document.createElement('option');
        option.value = collection.name;
        option.textContent = collection.name;
        option.selected = collection.active;
        collectionSelect.appendChild(option);
    });

    // Clear slider container
    container.innerHTML = '';

    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    activeCollection.sliders.forEach((slider) => {
        if (!slider.enabled || !slider.property || !slider.name) {
            return;
        }

        const renderer = document.createElement('template');
        renderer.innerHTML = sliderTemplate;

        const sliderId = CSS.escape('slider_macro_' + slider.property);
        const rangeBlock = renderer.content.querySelector('.range-block') as HTMLDivElement;
        const titleElement = renderer.content.querySelector('.range-block-title') as HTMLSpanElement;

        const existingSlider = document.getElementById(sliderId);
        if (existingSlider) {
            toastr.warning('Duplicate slider property name: ' + slider.property);
            console.warn('Duplicate slider detected:', sliderId);
            return;
        }

        titleElement.textContent = slider.name;
        console.log(`Rendering slider: ${slider.name} (${slider.type})`);

        // --- Numeric Slider Logic ---
        if (slider.type === 'Numeric' || !slider.type) { // Default to Numeric
            if (slider.value < parseFloat(slider.min)) {
                slider.value = parseFloat(slider.min);
            }

            if (slider.value > parseFloat(slider.max)) {
                slider.value = parseFloat(slider.max);
            }

            const sliderInput = renderer.content.querySelector('input[type="range"]') as HTMLInputElement;
            const numberInput = renderer.content.querySelector('input[type="number"]') as HTMLInputElement;

            sliderInput.id = sliderId;
            sliderInput.min = slider.min;
            sliderInput.max = slider.max;
            sliderInput.step = slider.step;
            sliderInput.value = slider.value.toString();

            numberInput.id = sliderId + '_number';
            numberInput.min = slider.min;
            numberInput.max = slider.max;
            numberInput.step = slider.step;
            numberInput.value = slider.value.toString();
            numberInput.dataset.for = sliderId;

            const inputEventListener = () => {
                slider.value = parseFloat(sliderInput.value);
                numberInput.value = sliderInput.value;
                saveSettingsDebounced();
                updateSliderMacros(settings);
            };
            sliderInput.addEventListener('input', inputEventListener);
            $(sliderInput).on('input', inputEventListener);
        }

        // --- Boolean Slider Logic ---
        else if (slider.type === 'Boolean') {
            const rangeContainer = renderer.content.querySelector('.range-block-range') as HTMLDivElement;
            const counterContainer = renderer.content.querySelector('.range-block-counter') as HTMLDivElement;
            const sliderInput = renderer.content.querySelector('input[type="range"]') as HTMLInputElement;

            // Show slider, hide others
            if (rangeContainer) {
                rangeContainer.style.display = '';
                rangeContainer.style.flex = '1';
                rangeContainer.style.width = '100%';
            }

            // Text display for True/False
            const valueDisplay = document.createElement('span');
            valueDisplay.style.marginLeft = '10px';
            valueDisplay.style.fontWeight = 'bold';

            if (counterContainer) {
                counterContainer.style.display = ''; // Ensure visible
                counterContainer.innerHTML = '';
                counterContainer.appendChild(valueDisplay);
            }

            sliderInput.id = sliderId;
            sliderInput.min = '0';
            sliderInput.max = '1';
            sliderInput.step = '1';

            // User wants True to the Left (0) and False to the Right (1).
            // Stored value: 1 = True, 0 = False.
            // UI value: 0 = True, 1 = False.
            // Conversion: UI = 1 - Stored
            sliderInput.value = (1 - (slider.value ? 1 : 0)).toString();

            // Set initial text
            valueDisplay.textContent = (slider.value ? 1 : 0) === 1 ? 'True' : 'False';

            const inputEventListener = () => {
                const uiValue = parseInt(sliderInput.value, 10);
                // Inverse logic: 0 -> True (1), 1 -> False (0)
                const isTrue = uiValue === 0;
                (slider.value as any) = isTrue ? 1 : 0;
                valueDisplay.textContent = isTrue ? 'True' : 'False';

                saveSettingsDebounced();
                updateSliderMacros(settings);
            };
            sliderInput.addEventListener('input', inputEventListener);
            $(sliderInput).on('input', inputEventListener);

        }

        // --- MultiSelect Slider Logic ---
        else if (slider.type === 'MultiSelect') {
            const rangeContainer = renderer.content.querySelector('.range-block-range') as HTMLDivElement;
            const counterContainer = renderer.content.querySelector('.range-block-counter') as HTMLDivElement;
            const sliderInput = renderer.content.querySelector('input[type="range"]') as HTMLInputElement;
            const numberInput = renderer.content.querySelector('input[type="number"]') as HTMLInputElement;

            // Ensure we have options
            const validOptions = (slider.options || []).filter(o => o.trim() !== '');
            if (validOptions.length < 2) {
                // Not enough options to render a proper slider
                titleElement.textContent += ' (Config Error: < 2 Options)';
                return;
            }

            // Replace number input with a text display
            const valueDisplay = document.createElement('span');
            valueDisplay.style.marginLeft = '10px';
            valueDisplay.style.fontWeight = 'bold';
            if (counterContainer && numberInput) {
                counterContainer.innerHTML = '';
                counterContainer.appendChild(valueDisplay);
            }

            sliderInput.id = sliderId;
            sliderInput.min = '0';
            sliderInput.max = (validOptions.length - 1).toString();
            sliderInput.step = '1';

            // Ensure value is within bounds
            if (slider.value < 0 || slider.value >= validOptions.length) {
                slider.value = 0;
            }

            const formatOption = (text: string) => {
                return text.length > 10 ? text.substring(0, 10) + '...' : text;
            };

            sliderInput.value = slider.value.toString();
            valueDisplay.textContent = formatOption(validOptions[slider.value]);
            valueDisplay.title = validOptions[slider.value]; // Tooltip for full text

            const inputEventListener = () => {
                const index = parseInt(sliderInput.value, 10);
                slider.value = index;
                const text = validOptions[index] || '';
                valueDisplay.textContent = formatOption(text);
                valueDisplay.title = text;
                saveSettingsDebounced();
                updateSliderMacros(settings);
            };

            sliderInput.addEventListener('input', inputEventListener);
            $(sliderInput).on('input', inputEventListener);
        }

        container.appendChild(renderer.content);
    });

    // Update the macros based on the current settings (initial load)
    updateSliderMacros(settings);
}

function mergeYamlIntoObject(obj: object, yamlString: string) {
    if (!yamlString) {
        return obj;
    }

    try {
        const parsedObject = yaml.parse(yamlString);

        if (Array.isArray(parsedObject)) {
            for (const item of parsedObject) {
                if (typeof item === 'object' && item && !Array.isArray(item)) {
                    Object.assign(obj, item);
                }
            }
        }
        else if (parsedObject && typeof parsedObject === 'object') {
            Object.assign(obj, parsedObject);
        }
    } catch {
        // Do nothing
    }

    return obj;
}




// This function is used to update the macros based on the current slider settings above.
function updateSliderMacros(settings: ExtensionSettings) {
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    // Loop through each slider in the active collection and register it as a macro.
    activeCollection.sliders.forEach((slider) => {
        if (!slider.enabled || !slider.property) {
            return;
        }

        let macroHandler: () => string;

        if (slider.type === 'MultiSelect') {
            const validOptions = (slider.options || []).filter(o => o.trim() !== '');
            macroHandler = () => validOptions[slider.value] || '';
        } else if (slider.type === 'Boolean') {
            // 1 = True, 0 = False
            macroHandler = () => (slider.value === 1 ? 'true' : 'false');
        } else {
            macroHandler = () => slider.value.toString();
        }
        const description = `Slider Macro: ${slider.name}`;
        if (power_user.experimental_macro_engine) {
            macros.register(slider.property, {
                category: macros.category.PROMPTS,
                description: description,
                handler: macroHandler,
            });
            // Fallback for old macro engine.Remove this once the experimental macro engine is the default.
        } else {
            MacrosParser.registerMacro(slider.property, macroHandler, description);
        }
    });
};


// Preset binding event handler without the chat completion body append stuff.
function setupEventHandlers(settings: ExtensionSettings): void {
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        const presetName = chatCompletionSettings.preset_settings_openai;
        const activeCollection = settings.collections.find(c => c.active);
        if (!activeCollection) {
            return;
        }

        const collectionWithPreset = settings.collections.find(c => c.presets.includes(presetName));
        if (collectionWithPreset && collectionWithPreset !== activeCollection) {
            collectionWithPreset.active = true;
            activeCollection.active = false;

            saveSettingsDebounced();
            renderSliderConfigs(settings);
            // Re-render the completions sliders to reflect the new collection
            renderCompletionSliders(settings);
        }
    });
}

(async function init() {
    const settings = getSettings();
    addSettingsControls(settings);
    renderSliderConfigs(settings);
    setupEventHandlers(settings);
    saveSettingsDebounced();
})();
