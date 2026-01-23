/** Central Imports - Will make them a dedicated file later for cleanliness */

import yaml from 'yaml';
import './style.css';
import settingsTemplate from './settings.html';
import configTemplate from './config.html';
import sliderTemplate from './slider.html';
// import { macros, MacroCategory } from '../../../../macros/macro-system.js';
// import { MacrosParser } from '../../../../macros.js';
// import { MacroCategory } from '../../../../macros/engine/MacroRegistry';

const { saveSettingsDebounced, event_types, eventSource, chatCompletionSettings, Popup, powerUserSettings: power_user, macros } = SillyTavern.getContext();

const MODULE_NAME = 'sliderMacros';

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
        create: document.getElementById('custom_sliders_create') as HTMLInputElement,
        list: document.getElementById('custom_sliders_list') as HTMLDivElement,
        rangeBlock: document.getElementById('range_block_openai') as HTMLDivElement,
        collections: document.getElementById('custom_sliders_collections') as HTMLSelectElement,
        createCollection: document.getElementById('custom_sliders_create_collection') as HTMLDivElement,
        deleteCollection: document.getElementById('custom_sliders_delete_collection') as HTMLDivElement,
        bindToPreset: document.getElementById('custom_sliders_bind_to_preset') as HTMLDivElement,
        hint: document.getElementById('custom_sliders_hint') as HTMLDivElement,
        importFile: document.getElementById('custom_sliders_import_file') as HTMLInputElement,
        importCollection: document.getElementById('custom_sliders_import_collection') as HTMLDivElement,
        exportCollection: document.getElementById('custom_sliders_export_collection') as HTMLDivElement,
    };
}

export function addSettingsControls(settings: ExtensionSettings): void {
    const settingsContainer = document.getElementById('custom_sliders_container') ?? document.getElementById('extensions_settings');
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
    });

    renderSliderConfigs(settings);
}

// Commented out because it involves Chat Completion Sources
/* function renderHint(): void {
    const elements = getUIElements();
    const context = SillyTavern.getContext();
    const displayHint = context.mainApi !== 'openai' || chatCompletionSettings.chat_completion_source !== 'custom';
    elements.hint.style.display = displayHint ? '' : 'none';
} */

function renderSliderConfigs(settings: ExtensionSettings): void {
    const elements = getUIElements();

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

        const nameInput = renderer.content.querySelector('input[name="name"]') as HTMLInputElement;
        const propertyInput = renderer.content.querySelector('input[name="property"]') as HTMLInputElement;
        const minInput = renderer.content.querySelector('input[name="min"]') as HTMLInputElement;
        const maxInput = renderer.content.querySelector('input[name="max"]') as HTMLInputElement;
        const stepInput = renderer.content.querySelector('input[name="step"]') as HTMLInputElement;
        const enableCheckbox = renderer.content.querySelector('input[name="enabled"]') as HTMLInputElement;

        const deleteButton = renderer.content.querySelector('button[name="delete"]') as HTMLButtonElement;
        const upButton = renderer.content.querySelector('button[name="up"]') as HTMLButtonElement;
        const downButton = renderer.content.querySelector('button[name="down"]') as HTMLButtonElement;

        nameInput.value = slider.name;
        propertyInput.value = slider.property;
        minInput.value = slider.min;
        maxInput.value = slider.max;
        stepInput.value = slider.step;
        enableCheckbox.checked = slider.enabled;

        nameInput.addEventListener('input', (e) => {
            slider.name = nameInput.value;
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        propertyInput.addEventListener('input', (e) => {
            slider.property = propertyInput.value;
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        minInput.addEventListener('input', (e) => {
            slider.min = minInput.value;
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        maxInput.addEventListener('input', (e) => {
            slider.max = maxInput.value;
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        stepInput.addEventListener('input', (e) => {
            slider.step = stepInput.value;
            renderCompletionSliders(settings);
            saveSettingsDebounced();
        });

        enableCheckbox.addEventListener('change', (e) => {
            slider.enabled = enableCheckbox.checked;
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
        elements.list.appendChild(document.createElement('hr'));
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

    let container = elements.rangeBlock.querySelector('.custom_sliders_container');

    if (!container) {
        container = document.createElement('div');
        container.classList.add('custom_sliders_container');

        const referenceElement = Array.from(elements.rangeBlock.querySelectorAll('.range-block:has(input[type="range"])')).pop();
        if (!referenceElement) {
            return;
        }

        referenceElement.insertAdjacentElement('afterend', container);
    }

    container.innerHTML = '';
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    activeCollection.sliders.forEach((slider) => {
        if (!slider.enabled || !slider.property || !slider.name) {
            return;
        }

        if (slider.value < parseFloat(slider.min)) {
            slider.value = parseFloat(slider.min);
        }

        if (slider.value > parseFloat(slider.max)) {
            slider.value = parseFloat(slider.max);
        }

        const renderer = document.createElement('template');
        renderer.innerHTML = sliderTemplate;

        const sliderId = CSS.escape('custom_slider_' + slider.property);
        const rangeBlock = renderer.content.querySelector('.range-block') as HTMLDivElement;
        const titleElement = renderer.content.querySelector('.range-block-title') as HTMLSpanElement;
        const sliderInput = renderer.content.querySelector('input[type="range"]') as HTMLInputElement;
        const numberInput = renderer.content.querySelector('input[type="number"]') as HTMLInputElement;

        const existingSlider = document.getElementById(sliderId);
        if (existingSlider) {
            toastr.warning('Duplicate slider property name: ' + slider.property);
            return;
        }

        titleElement.textContent = slider.name;
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
        };
        sliderInput.addEventListener('input', inputEventListener);
        $(sliderInput).on('input', inputEventListener);

        // Commenting out due to mentioning Chat Completion Source
        //        if (chatCompletionSettings.chat_completion_source !== 'custom') {
        //            rangeBlock.style.display = 'none';
        //        }

        container.appendChild(renderer.content);
    });
    // Update the macros based on the current settings
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

// This function is used to set up the visibility of the slider type options in the settings UI.
function setupSliderTypeVisibility() {
    const typeSelect = document.querySelector('select[name="type"]') as HTMLSelectElement;
    const numericOnly = document.querySelector('.numeric-only') as HTMLElement;
    const booleanOnly = document.querySelector('.boolean-only') as HTMLElement;
    const multiSelectOnly = document.querySelector('.multiselect-only') as HTMLElement;

    if (!typeSelect || !numericOnly || !booleanOnly || !multiSelectOnly) {
        console.warn('Slider type elements missing in DOM');
        return;
    }

    function updateVisibility() {
        const type = typeSelect.value;

        numericOnly.style.display = type === 'Numeric' ? '' : 'none';
        numericOnly.querySelectorAll('input').forEach((i) => (i as HTMLInputElement).disabled = type !== 'Numeric');

        booleanOnly.style.display = type === 'Boolean' ? '' : 'none';
        booleanOnly.querySelectorAll('input, select').forEach((i) => (i as HTMLInputElement | HTMLSelectElement).disabled = type !== 'Boolean');

        multiSelectOnly.style.display = type === 'MultiSelect' ? '' : 'none';
        multiSelectOnly.querySelectorAll('input').forEach((i) => (i as HTMLInputElement).disabled = type !== 'MultiSelect');
    }

    typeSelect.addEventListener('change', updateVisibility);
    updateVisibility(); // init
};


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

        const macroHandler = () => slider.value.toString();
        const description = `Custom Slider: ${slider.name}`;
        if (power_user.experimental_macro_engine) {
            macros.register(slider.property, {
                category: macros.category.PROMPTS,
                description: description,
                handler: macroHandler,
            });
            //        } else {
            //            MacrosParser.registerMacro(slider.property, macroHandler, description);
        }
    });
};

// The below is commented out because it's not needed for this extension, it's all chat completion stuff. The original extension sends the sliders to the chat completion request, but this extension doesn't need to do that.
/* function setupEventHandlers(settings: ExtensionSettings): void {
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, (data: ChatCompletionRequestData) => {
        if (data.chat_completion_source !== 'custom') {
            return;
        }
        const activeCollection = settings.collections.find(c => c.active);
        if (!activeCollection) {
            return;
        }

        const customBody = mergeYamlIntoObject({}, data.custom_include_body);
        const sliders = activeCollection.sliders.filter(s => s.enabled).reduce((acc, slider) => {
            if (slider.property && !isNaN(slider.value)) {
                acc[slider.property] = slider.value;
            }
            return acc;
        }, {} as Record<string, number>);
        Object.assign(customBody, sliders);
        data.custom_include_body = yaml.stringify(customBody);
    });
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
        }
    });
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        renderHint();
    });
} */

(async function init() {
    const settings = getSettings();
    addSettingsControls(settings);
    renderSliderConfigs(settings);
    //    setupEventHandlers(settings);
    setupSliderTypeVisibility();
    saveSettingsDebounced();
})();
