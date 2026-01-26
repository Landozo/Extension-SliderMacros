/** Central Imports - Will make them a dedicated file later for cleanliness */

import yaml from 'yaml';
import './style.css';
import settingsTemplate from './settings.html';
import configTemplate from './config.html';
import sliderTemplate from './slider.html';
import groupTemplate from './group.html';
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

interface DropdownOption {
    key: string;
    value: string;
}

interface SliderModel {
    name: string;
    property: string;
    type: string;
    min: string;
    max: string;
    step: string;
    value: number | string | boolean;
    enabled: boolean;
    options: string[];
    // Dropdown type fields
    dropdownOptions: DropdownOption[];
    // Color type fields
    colorFormat: 'hex' | 'rgb' | 'hsv';
    // Checkbox type fields
    checkboxTrueValue: string;
    checkboxFalseValue: string;
    groupId: string | null;
}

interface SliderGroup {
    id: string;
    name: string;
    collapsed: boolean;
}

interface SliderCollection {
    active: boolean;
    name: string;
    sliders: SliderModel[];
    presets: string[];
    groups: SliderGroup[];
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
        groups: [],
    }],
});

function generateGroupId(): string {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

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

    // Migration: Add groups array to collections that don't have it
    for (const collection of settings.collections) {
        if (!collection.groups) {
            collection.groups = [];
        }
        // Migration: Add groupId to sliders that don't have it
        for (const slider of collection.sliders) {
            if (slider.groupId === undefined) {
                slider.groupId = null;
            }
        }
    }

    return settings;
}

function getUIElements() {
    return {
        create: document.getElementById('slider_macros_create') as HTMLInputElement,
        createGroup: document.getElementById('slider_macros_create_group') as HTMLDivElement,
        list: document.getElementById('slider_macros_list') as HTMLDivElement,
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
    elements.createGroup.addEventListener('click', createGroup);
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

    // Initial render of slider configs
    renderSliderConfigs(settings);
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
        dropdownOptions: [],
        colorFormat: 'hex',
        checkboxTrueValue: 'true',
        checkboxFalseValue: 'false',
        groupId: null,
    });

    renderSliderConfigs(settings);
}

// This function is used to create a new group from the settings panel.
function createGroup(): void {
    const settings = getSettings();
    const activeCollection = settings.collections.find(c => c.active);
    if (!activeCollection) {
        return;
    }
    activeCollection.groups.push({
        id: generateGroupId(),
        name: 'New Group',
        collapsed: false,
    });

    saveSettingsDebounced();
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
        const cardGroupBadge = renderer.content.querySelector('.slider_macros_card_group_badge') as HTMLSpanElement;
        const cardGroupName = renderer.content.querySelector('.slider_macros_card_group_name') as HTMLSpanElement;

        const nameInput = renderer.content.querySelector('input[name="name"]') as HTMLInputElement;
        const propertyInput = renderer.content.querySelector('input[name="property"]') as HTMLInputElement;
        const minInput = renderer.content.querySelector('input[name="min"]') as HTMLInputElement;
        const maxInput = renderer.content.querySelector('input[name="max"]') as HTMLInputElement;
        const stepInput = renderer.content.querySelector('input[name="step"]') as HTMLInputElement;
        const enableCheckbox = renderer.content.querySelector('input[name="enabled"]') as HTMLInputElement;
        const typeSelect = renderer.content.querySelector('select[name="type"]') as HTMLSelectElement;
        const groupIdSelect = renderer.content.querySelector('select[name="groupId"]') as HTMLSelectElement;

        const deleteButton = renderer.content.querySelector('button[name="delete"]') as HTMLButtonElement;
        const upButton = renderer.content.querySelector('button[name="up"]') as HTMLButtonElement;
        const downButton = renderer.content.querySelector('button[name="down"]') as HTMLButtonElement;

        const numericOnly = renderer.content.querySelector('.numeric-only') as HTMLElement;
        const booleanOnly = renderer.content.querySelector('.boolean-only') as HTMLElement;
        const multiSelectOnly = renderer.content.querySelector('.multiselect-only') as HTMLElement;
        const dropdownOnly = renderer.content.querySelector('.dropdown-only') as HTMLElement;
        const colorOnly = renderer.content.querySelector('.color-only') as HTMLElement;
        const checkboxOnly = renderer.content.querySelector('.checkbox-only') as HTMLElement;

        // New type inputs
        const colorFormatSelect = renderer.content.querySelector('select[name="colorFormat"]') as HTMLSelectElement;
        const defaultColorInput = renderer.content.querySelector('input[name="defaultColor"]') as HTMLInputElement;
        const checkboxTrueValueInput = renderer.content.querySelector('input[name="checkboxTrueValue"]') as HTMLInputElement;
        const checkboxFalseValueInput = renderer.content.querySelector('input[name="checkboxFalseValue"]') as HTMLInputElement;
        const defaultCheckboxSelect = renderer.content.querySelector('select[name="defaultCheckbox"]') as HTMLSelectElement;
        const dropdownOptionsContainer = renderer.content.querySelector('.slider_macros_dropdown_options') as HTMLDivElement;
        const addDropdownOptionButton = renderer.content.querySelector('button[name="addDropdownOption"]') as HTMLButtonElement;

        // Ensure defaults for new fields
        if (!slider.dropdownOptions) slider.dropdownOptions = [];
        if (!slider.colorFormat) slider.colorFormat = 'hex';
        if (!slider.checkboxTrueValue) slider.checkboxTrueValue = 'true';
        if (!slider.checkboxFalseValue) slider.checkboxFalseValue = 'false';

        // Set initial values
        nameInput.value = slider.name;
        propertyInput.value = slider.property;
        minInput.value = slider.min;
        maxInput.value = slider.max;
        stepInput.value = slider.step;
        enableCheckbox.checked = slider.enabled;
        typeSelect.value = slider.type || 'Numeric';

        // Set values for new type inputs
        if (colorFormatSelect) colorFormatSelect.value = slider.colorFormat;
        if (defaultColorInput) defaultColorInput.value = typeof slider.value === 'string' && slider.value.startsWith('#') ? slider.value : '#ffffff';
        if (checkboxTrueValueInput) checkboxTrueValueInput.value = slider.checkboxTrueValue;
        if (checkboxFalseValueInput) checkboxFalseValueInput.value = slider.checkboxFalseValue;
        if (defaultCheckboxSelect) defaultCheckboxSelect.value = slider.value === true ? 'true' : 'false';

        // Populate group selector
        if (groupIdSelect) {
            groupIdSelect.innerHTML = '<option value="">No Group</option>';
            activeCollection.groups.forEach((group) => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                option.selected = slider.groupId === group.id;
                groupIdSelect.appendChild(option);
            });
        }

        // Update card header display
        cardNameDisplay.textContent = slider.name || 'New Slider';
        cardMacroDisplay.textContent = slider.property || '';
        cardTypeBadge.textContent = slider.type || 'Numeric';

        // Update group badge display
        const updateGroupBadge = () => {
            if (cardGroupBadge && cardGroupName) {
                const assignedGroup = activeCollection.groups.find(g => g.id === slider.groupId);
                if (assignedGroup) {
                    cardGroupBadge.dataset.visible = 'true';
                    cardGroupName.textContent = assignedGroup.name;
                } else {
                    cardGroupBadge.dataset.visible = 'false';
                    cardGroupName.textContent = '';
                }
            }
        };
        updateGroupBadge();

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
            if (dropdownOnly) dropdownOnly.style.display = type === 'Dropdown' ? 'block' : 'none';
            if (colorOnly) colorOnly.style.display = type === 'Color' ? 'block' : 'none';
            if (checkboxOnly) checkboxOnly.style.display = type === 'Checkbox' ? 'block' : 'none';
        };

        // Dropdown options management
        const renderDropdownOptions = () => {
            if (!dropdownOptionsContainer) return;
            dropdownOptionsContainer.innerHTML = '';
            slider.dropdownOptions.forEach((opt, optIndex) => {
                const row = document.createElement('div');
                row.className = 'slider_macros_dropdown_option_row';

                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.className = 'text_pole slider_macros_dropdown_key';
                keyInput.placeholder = 'Display name';
                keyInput.value = opt.key;
                keyInput.addEventListener('input', () => {
                    slider.dropdownOptions[optIndex].key = keyInput.value;
                    debouncedRender();
                    debouncedSaveSettings();
                });

                const arrow = document.createElement('span');
                arrow.className = 'slider_macros_dropdown_arrow';
                arrow.textContent = '→';

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'text_pole slider_macros_dropdown_value';
                valueInput.placeholder = 'Macro value';
                valueInput.value = opt.value;
                valueInput.addEventListener('input', () => {
                    slider.dropdownOptions[optIndex].value = valueInput.value;
                    debouncedRender();
                    debouncedSaveSettings();
                });

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'menu_button menu_button_icon slider_macros_btn_remove_option';
                removeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
                removeBtn.title = 'Remove option';
                removeBtn.addEventListener('click', () => {
                    slider.dropdownOptions.splice(optIndex, 1);
                    renderDropdownOptions();
                    debouncedRender();
                    debouncedSaveSettings();
                });

                row.appendChild(keyInput);
                row.appendChild(arrow);
                row.appendChild(valueInput);
                row.appendChild(removeBtn);
                dropdownOptionsContainer.appendChild(row);
            });
        };

        renderDropdownOptions();

        if (addDropdownOptionButton) {
            addDropdownOptionButton.addEventListener('click', () => {
                slider.dropdownOptions.push({ key: '', value: '' });
                renderDropdownOptions();
                debouncedSaveSettings();
            });
        }

        // Color format change handler
        if (colorFormatSelect) {
            colorFormatSelect.addEventListener('change', () => {
                slider.colorFormat = colorFormatSelect.value as 'hex' | 'rgb' | 'hsv';
                debouncedRender();
                debouncedSaveSettings();
            });
        }

        // Default color handler
        if (defaultColorInput) {
            defaultColorInput.addEventListener('input', () => {
                slider.value = defaultColorInput.value;
                debouncedRender();
                debouncedSaveSettings();
            });
        }

        // Checkbox value handlers
        if (checkboxTrueValueInput) {
            checkboxTrueValueInput.addEventListener('input', () => {
                slider.checkboxTrueValue = checkboxTrueValueInput.value;
                debouncedRender();
                debouncedSaveSettings();
            });
        }

        if (checkboxFalseValueInput) {
            checkboxFalseValueInput.addEventListener('input', () => {
                slider.checkboxFalseValue = checkboxFalseValueInput.value;
                debouncedRender();
                debouncedSaveSettings();
            });
        }

        if (defaultCheckboxSelect) {
            defaultCheckboxSelect.addEventListener('change', () => {
                slider.value = defaultCheckboxSelect.value === 'true';
                debouncedRender();
                debouncedSaveSettings();
            });
        }

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

        // Event listener for group change
        if (groupIdSelect) {
            groupIdSelect.addEventListener('change', () => {
                slider.groupId = groupIdSelect.value || null;
                updateGroupBadge();
                saveSettingsDebounced();
                renderCompletionSliders(settings);
            });
        }

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

    // Render groups
    activeCollection.groups.forEach((group, groupIndex) => {
        const renderer = document.createElement('template');
        renderer.innerHTML = groupTemplate;

        const card = renderer.content.querySelector('.slider_macros_group_card') as HTMLDivElement;
        const cardHeader = renderer.content.querySelector('.slider_macros_group_card_header') as HTMLDivElement;
        const cardNameDisplay = renderer.content.querySelector('.slider_macros_group_card_name') as HTMLSpanElement;
        const cardCountDisplay = renderer.content.querySelector('.slider_macros_group_card_count') as HTMLSpanElement;

        const nameInput = renderer.content.querySelector('input[name="groupName"]') as HTMLInputElement;
        const deleteButton = renderer.content.querySelector('button[name="deleteGroup"]') as HTMLButtonElement;
        const upButton = renderer.content.querySelector('button[name="up"]') as HTMLButtonElement;
        const downButton = renderer.content.querySelector('button[name="down"]') as HTMLButtonElement;

        // Count sliders in this group
        const slidersInGroup = activeCollection.sliders.filter(s => s.groupId === group.id).length;

        // Set initial values
        card.dataset.groupId = group.id;
        cardNameDisplay.textContent = group.name || 'New Group';
        cardCountDisplay.textContent = `(${slidersInGroup} slider${slidersInGroup !== 1 ? 's' : ''})`;
        nameInput.value = group.name;

        // Expand/collapse toggle
        cardHeader.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.slider_macros_card_controls')) {
                return;
            }
            const isExpanded = card.dataset.expanded === 'true';
            card.dataset.expanded = isExpanded ? 'false' : 'true';
        });

        // Name change
        nameInput.addEventListener('input', () => {
            group.name = nameInput.value;
            cardNameDisplay.textContent = group.name || 'New Group';
            debouncedSaveSettings();
        });

        // Delete group
        deleteButton.addEventListener('click', async () => {
            const confirm = await Popup.show.confirm('Delete Group', `Are you sure you want to delete the group "${group.name}"? Sliders in this group will become ungrouped.`);
            if (!confirm) {
                return;
            }
            // Ungroup all sliders in this group
            activeCollection.sliders.forEach(s => {
                if (s.groupId === group.id) {
                    s.groupId = null;
                }
            });
            activeCollection.groups.splice(groupIndex, 1);
            renderSliderConfigs(settings);
            saveSettingsDebounced();
        });

        // Move up
        upButton.addEventListener('click', () => {
            if (groupIndex > 0) {
                const temp = activeCollection.groups[groupIndex - 1];
                activeCollection.groups[groupIndex - 1] = activeCollection.groups[groupIndex];
                activeCollection.groups[groupIndex] = temp;
                renderSliderConfigs(settings);
                saveSettingsDebounced();
            }
        });

        // Move down
        downButton.addEventListener('click', () => {
            if (groupIndex < activeCollection.groups.length - 1) {
                const temp = activeCollection.groups[groupIndex + 1];
                activeCollection.groups[groupIndex + 1] = activeCollection.groups[groupIndex];
                activeCollection.groups[groupIndex] = temp;
                renderSliderConfigs(settings);
                saveSettingsDebounced();
            }
        });

        elements.list.appendChild(renderer.content);
    });

    if (activeCollection.sliders.length === 0 && activeCollection.groups.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.classList.add('empty-message');
        emptyMessage.textContent = 'No custom sliders or groups. Click "Create Slider" or "Create Group" to add one.';
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

        // Create new container
        container = document.createElement('div');
        container.id = CONTAINER_ID;
        container.className = 'slider_macros_container';
        drawerContent.appendChild(container);

        drawer.appendChild(drawerContent);
    }

    // Always try to attach to the correct parent if available, even if drawer exists
    const completionPromptManager = document.getElementById('completion_prompt_manager');
    if (completionPromptManager) {
        if (drawer.parentElement !== completionPromptManager || completionPromptManager.firstChild !== drawer) {
            completionPromptManager.insertBefore(drawer, completionPromptManager.firstChild);
        }
    } else {
        // If the target container doesn't exist yet, we don't attach the drawer.
        // The MutationObserver will call this again when it appears.
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

    // Helper function to render a single slider to a target container
    const renderSliderToContainer = (slider: SliderModel, targetContainer: HTMLElement) => {
        if (!slider.enabled || !slider.property || !slider.name) {
            return;
        }

        const renderer = document.createElement('template');
        renderer.innerHTML = sliderTemplate;

        const sliderId = CSS.escape('slider_macro_' + slider.property);
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

        // --- Dropdown Logic ---
        else if (slider.type === 'Dropdown') {
            const rangeContainer = renderer.content.querySelector('.range-block-range') as HTMLDivElement;
            const counterContainer = renderer.content.querySelector('.range-block-counter') as HTMLDivElement;

            // Ensure we have options
            const validOptions = (slider.dropdownOptions || []).filter(o => o.key.trim() !== '');
            if (validOptions.length < 1) {
                titleElement.textContent += ' (Config Error: No Options)';
                return;
            }

            // Hide the range slider, use a select dropdown instead
            if (rangeContainer) {
                rangeContainer.innerHTML = '';
                rangeContainer.style.flex = '1';

                const selectElement = document.createElement('select');
                selectElement.id = sliderId;
                selectElement.className = 'text_pole slider_macros_dropdown_select';

                validOptions.forEach((opt) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt.key;
                    optionEl.textContent = opt.key;
                    if (slider.value === opt.key) {
                        optionEl.selected = true;
                    }
                    selectElement.appendChild(optionEl);
                });

                // Set default if no value
                if (!slider.value || !validOptions.find(o => o.key === slider.value)) {
                    slider.value = validOptions[0].key;
                    selectElement.value = validOptions[0].key;
                }

                selectElement.addEventListener('change', () => {
                    slider.value = selectElement.value;
                    saveSettingsDebounced();
                    updateSliderMacros(settings);
                });

                rangeContainer.appendChild(selectElement);
            }

            // Hide the counter
            if (counterContainer) {
                counterContainer.style.display = 'none';
            }
        }

        // --- Color Picker Logic ---
        else if (slider.type === 'Color') {
            const rangeContainer = renderer.content.querySelector('.range-block-range') as HTMLDivElement;
            const counterContainer = renderer.content.querySelector('.range-block-counter') as HTMLDivElement;

            // Hide the range slider, use color input instead
            if (rangeContainer) {
                rangeContainer.innerHTML = '';
                rangeContainer.style.flex = '1';
                rangeContainer.style.display = 'flex';
                rangeContainer.style.alignItems = 'center';
                rangeContainer.style.gap = '10px';

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.id = sliderId;
                colorInput.className = 'slider_macros_color_input';
                colorInput.value = typeof slider.value === 'string' && slider.value.startsWith('#') ? slider.value : '#ffffff';

                const hexDisplay = document.createElement('input');
                hexDisplay.type = 'text';
                hexDisplay.className = 'text_pole slider_macros_color_hex';
                hexDisplay.value = colorInput.value.toUpperCase();
                hexDisplay.maxLength = 7;

                const updateFromColor = () => {
                    slider.value = colorInput.value;
                    hexDisplay.value = colorInput.value.toUpperCase();
                    saveSettingsDebounced();
                    updateSliderMacros(settings);
                };

                const updateFromHex = () => {
                    let hex = hexDisplay.value.trim();
                    if (!hex.startsWith('#')) hex = '#' + hex;
                    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                        colorInput.value = hex;
                        slider.value = hex;
                        saveSettingsDebounced();
                        updateSliderMacros(settings);
                    }
                };

                colorInput.addEventListener('input', updateFromColor);
                hexDisplay.addEventListener('change', updateFromHex);

                rangeContainer.appendChild(colorInput);
                rangeContainer.appendChild(hexDisplay);
            }

            // Hide the counter
            if (counterContainer) {
                counterContainer.style.display = 'none';
            }
        }

        // --- Checkbox Logic ---
        else if (slider.type === 'Checkbox') {
            const rangeContainer = renderer.content.querySelector('.range-block-range') as HTMLDivElement;
            const counterContainer = renderer.content.querySelector('.range-block-counter') as HTMLDivElement;

            // Hide the range slider, use checkbox instead
            if (rangeContainer) {
                rangeContainer.innerHTML = '';
                rangeContainer.style.flex = '1';
                rangeContainer.style.display = 'flex';
                rangeContainer.style.alignItems = 'center';

                const checkboxLabel = document.createElement('label');
                checkboxLabel.className = 'checkbox_label slider_macros_checkbox_label';

                const checkboxInput = document.createElement('input');
                checkboxInput.type = 'checkbox';
                checkboxInput.id = sliderId;
                checkboxInput.checked = slider.value === true;

                const checkboxText = document.createElement('span');
                checkboxText.className = 'slider_macros_checkbox_text';
                checkboxText.textContent = slider.value === true ? (slider.checkboxTrueValue || 'true') : (slider.checkboxFalseValue || 'false');

                checkboxInput.addEventListener('change', () => {
                    slider.value = checkboxInput.checked;
                    checkboxText.textContent = checkboxInput.checked ? (slider.checkboxTrueValue || 'true') : (slider.checkboxFalseValue || 'false');
                    saveSettingsDebounced();
                    updateSliderMacros(settings);
                });

                checkboxLabel.appendChild(checkboxInput);
                checkboxLabel.appendChild(checkboxText);
                rangeContainer.appendChild(checkboxLabel);
            }

            // Hide the counter
            if (counterContainer) {
                counterContainer.style.display = 'none';
            }
        }

        targetContainer.appendChild(renderer.content);
    };

    // Render ungrouped sliders first
    const ungroupedSliders = activeCollection.sliders.filter(s => !s.groupId);
    ungroupedSliders.forEach(slider => renderSliderToContainer(slider, container));

    // Render groups with their sliders
    activeCollection.groups.forEach((group) => {
        const slidersInGroup = activeCollection.sliders.filter(s => s.groupId === group.id);

        // Skip empty groups in the completion panel
        if (slidersInGroup.filter(s => s.enabled && s.property && s.name).length === 0) {
            return;
        }

        // Create group container
        const groupContainer = document.createElement('div');
        groupContainer.className = 'slider_macros_group';
        groupContainer.dataset.groupId = group.id;
        groupContainer.dataset.collapsed = group.collapsed ? 'true' : 'false';

        // Create group header
        const groupHeader = document.createElement('div');
        groupHeader.className = 'slider_macros_group_header';

        const groupChevron = document.createElement('i');
        groupChevron.className = 'fa-solid fa-chevron-down slider_macros_group_chevron';

        const groupName = document.createElement('span');
        groupName.className = 'slider_macros_group_name';
        groupName.textContent = group.name;

        const groupCount = document.createElement('span');
        groupCount.className = 'slider_macros_group_count';
        const enabledCount = slidersInGroup.filter(s => s.enabled && s.property && s.name).length;
        groupCount.textContent = `(${enabledCount})`;

        groupHeader.appendChild(groupChevron);
        groupHeader.appendChild(groupName);
        groupHeader.appendChild(groupCount);

        // Toggle collapse on header click
        groupHeader.addEventListener('click', () => {
            const isCollapsed = groupContainer.dataset.collapsed === 'true';
            groupContainer.dataset.collapsed = isCollapsed ? 'false' : 'true';
            group.collapsed = !isCollapsed;
            saveSettingsDebounced();
        });

        groupContainer.appendChild(groupHeader);

        // Create group content
        const groupContent = document.createElement('div');
        groupContent.className = 'slider_macros_group_content';

        // Render sliders into group content
        slidersInGroup.forEach(slider => renderSliderToContainer(slider, groupContent));

        groupContainer.appendChild(groupContent);
        container.appendChild(groupContainer);
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
            macroHandler = () => validOptions[slider.value as number] || '';
        } else if (slider.type === 'Boolean') {
            // 1 = True, 0 = False
            macroHandler = () => (slider.value === 1 ? 'true' : 'false');
        } else if (slider.type === 'Dropdown') {
            // Dropdown: value is the selected key, output is the mapped value
            macroHandler = () => {
                const selectedKey = slider.value as string;
                const option = (slider.dropdownOptions || []).find(o => o.key === selectedKey);
                return option ? option.value : selectedKey;
            };
        } else if (slider.type === 'Color') {
            // Color: convert hex to the configured format
            macroHandler = () => {
                const hex = (slider.value as string) || '#ffffff';
                return formatColor(hex, slider.colorFormat || 'hex');
            };
        } else if (slider.type === 'Checkbox') {
            // Checkbox: output configured true/false values
            macroHandler = () => {
                return slider.value === true
                    ? (slider.checkboxTrueValue || 'true')
                    : (slider.checkboxFalseValue || 'false');
            };
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
}

// Color format conversion utilities
function formatColor(hex: string, format: 'hex' | 'rgb' | 'hsv'): string {
    // Ensure valid hex
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        hex = '#ffffff';
    }

    if (format === 'hex') {
        return hex.toUpperCase();
    }

    // Parse hex to RGB
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    if (format === 'rgb') {
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Convert RGB to HSV
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === rNorm) {
            h = ((gNorm - bNorm) / delta) % 6;
        } else if (max === gNorm) {
            h = (bNorm - rNorm) / delta + 2;
        } else {
            h = (rNorm - gNorm) / delta + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : Math.round((delta / max) * 100);
    const v = Math.round(max * 100);

    return `hsv(${h}, ${s}%, ${v}%)`;
}


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
        }
        // Re-render the completions sliders to reflect the new collection or restore valid UI
        setTimeout(() => {
            renderCompletionSliders(settings);
        }, 500);
    });
}
// Mutation observer for the oddities of the Sillytavern DOM redraws on preset switching. As usual, Prolix knew the magic word.
const observer = new MutationObserver(debounce(() => {
    const settings = getSettings();
    const target = document.getElementById('completion_prompt_manager');
    const drawer = document.getElementById('slider_macros_drawer');

    // If target exists but drawer is missing or displaced, re-render/move it.
    if (target && (!drawer || drawer.parentElement !== target)) {
        renderCompletionSliders(settings);
    }
}, 500));

(async function init() {
    const settings = getSettings();
    addSettingsControls(settings);
    renderCompletionSliders(settings);
    setupEventHandlers(settings);
    observer.observe(document.body, { childList: true, subtree: true });
    saveSettingsDebounced();
})();
