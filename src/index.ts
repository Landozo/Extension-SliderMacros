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

const { saveSettingsDebounced, event_types, eventSource, chatCompletionSettings, Popup, powerUserSettings: power_user, macros, MacrosParser, substituteParams, variables, resolveVariable } = (SillyTavern.getContext() as any);

const MODULE_NAME = 'sliderMacros';
const DEBOUNCE_DELAY = 300;

// Cache of protected (core) macro names - populated once at startup before any slider registration
// This prevents the issue where our slider overrides a core macro and then isProtected becomes false
let protectedMacroNamesCache: Set<string> | null = null;

/**
 * Initializes the cache of protected macro names.
 * Should be called once at startup before any slider macros are registered.
 */
function initProtectedMacrosCache(): void {
    if (protectedMacroNamesCache !== null) return; // Already initialized

    protectedMacroNamesCache = new Set<string>();

    // Get macros from the v2 registry
    if (macros?.registry?.getAllMacros) {
        try {
            const allMacros = macros.registry.getAllMacros({ excludeHiddenAliases: true });
            for (const macro of allMacros) {
                // Protected = core macro (not from an extension)
                if (!macro.source?.isExtension) {
                    protectedMacroNamesCache.add(macro.name);
                }
            }
            console.debug(`[SliderMacros] Cached ${protectedMacroNamesCache.size} protected macro names`);
        } catch (e) {
            console.warn('[SliderMacros] Failed to cache protected macros:', e);
        }
    }
}

/**
 * Checks if a macro name is a protected core macro.
 * Uses the cached list to avoid issues with our slider overriding the macro.
 */
function isProtectedMacro(macroName: string): boolean {
    if (protectedMacroNamesCache === null) {
        initProtectedMacrosCache();
    }
    return protectedMacroNamesCache?.has(macroName) || false;
}

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

// ============================================================================
// Universal Macro System Handler
// ============================================================================

interface MacroInfo {
    name: string;
    description: string;
    source: 'v2' | 'legacy' | 'extension' | 'core' | 'variable';
    sourceName: string;
    category: string;
    minArgs: number;
    isProtected: boolean;
    def?: unknown;
    // Variable-specific fields
    isVariable?: boolean;
    variableScope?: 'local' | 'global';
    variableValue?: unknown;
}

/**
 * Retrieves a macro value using the universal handler approach.
 * Prefers the 2.0 experimental engine, falls back to legacy system.
 * @param macroName - The name of the macro (without braces)
 * @returns The evaluated value, or the raw macro string if not found
 */
function getMacroValue(macroName: string): string {
    const raw = `{{${macroName}}}`;

    // 1. If experimental engine is enabled, try the new system first
    if (power_user?.experimental_macro_engine && macros?.engine) {
        try {
            const env = macros.envBuilder?.buildFromRawEnv({});
            if (env) {
                const newVal = macros.engine.evaluate(raw, env);
                if (newVal !== raw) return newVal;
            }
        } catch (e) {
            console.warn('[SliderMacros] Failed to retrieve macro from new engine:', e);
        }
    }

    // 2. Try the active system (Legacy or Experimental via substituteParams)
    if (typeof substituteParams === 'function') {
        const val = substituteParams(raw);
        if (val !== raw) return val;
    }

    // 3. If the active system is Legacy, explicitly check the New Engine as fallback
    if (!power_user?.experimental_macro_engine && macros?.registry && macros?.engine) {
        try {
            if (macros.registry.hasMacro(macroName)) {
                const env = macros.envBuilder?.buildFromRawEnv({});
                if (env) {
                    const newVal = macros.engine.evaluate(raw, env);
                    if (newVal !== raw) return newVal;
                }
            }
        } catch (e) {
            console.warn('[SliderMacros] Failed to retrieve macro from new engine fallback:', e);
        }
    }

    return raw;
}

/**
 * Checks if a macro exists in either system.
 * @param macroName - The name of the macro (without braces)
 * @returns True if the macro exists
 */
function hasMacro(macroName: string): boolean {
    // Check new registry first
    if (macros?.registry?.hasMacro?.(macroName)) {
        return true;
    }

    // Check legacy parser
    if (MacrosParser) {
        for (const { key } of MacrosParser) {
            if (key === macroName) return true;
        }
    }

    // Try to resolve it - if it changes, the macro exists
    const raw = `{{${macroName}}}`;
    const resolved = getMacroValue(macroName);
    return resolved !== raw;
}

/**
 * Lists all known macros from both systems with rich metadata.
 * Normalizes data structure for consistent filtering and identifies protected core macros.
 * Uses cached protected status to avoid issues with slider overrides.
 * @returns Array of macro info objects
 */
function getAllKnownMacros(): MacroInfo[] {
    const macroMap = new Map<string, MacroInfo>();

    // 1. Add everything from the New Registry (Rich metadata)
    // When Experimental is ON, this already includes Legacy macros.
    if (macros?.registry?.getAllMacros) {
        try {
            const newMacros = macros.registry.getAllMacros({ excludeHiddenAliases: true });
            for (const macro of newMacros) {
                // Calculate total minimum required arguments
                const minArgs = (macro.minArgs || 0) + (macro.list?.min || 0);
                // Use cached protected status to handle slider overrides correctly
                const isProtected = isProtectedMacro(macro.name);

                macroMap.set(macro.name, {
                    name: macro.name,
                    description: macro.description || '',
                    source: isProtected ? 'core' : (macro.source?.isExtension ? 'extension' : 'core'),
                    sourceName: macro.source?.name || 'unknown',
                    category: macro.category || 'unknown',
                    minArgs: minArgs,
                    isProtected: isProtected,
                    def: macro,
                });
            }
            console.debug(`[SliderMacros] Found ${macroMap.size} macros from v2 registry`);
        } catch (e) {
            console.warn('[SliderMacros] Failed to get macros from new registry:', e);
        }
    }

    // 2. Add Legacy macros (Fallback for when Experimental is OFF)
    // If Experimental is OFF, the New Registry won't have these, so we grab them here.
    // Legacy macros are typically registered by extensions, so they are generally NOT protected core macros.
    if (MacrosParser) {
        try {
            let legacyCount = 0;
            // Direct iteration (MacrosParser is iterable)
            if (typeof MacrosParser[Symbol.iterator] === 'function') {
                for (const item of MacrosParser) {
                    const key = item.key || item.name;
                    const description = item.description || '';
                    if (key && !macroMap.has(key)) {
                        macroMap.set(key, {
                            name: key,
                            description: description,
                            source: 'legacy',
                            sourceName: 'unknown (legacy)',
                            category: 'legacy',
                            // NORMALIZATION: Legacy macros are strictly {{key}} replacements.
                            // They do not support standard engine arguments, so we treat them as 0-arg.
                            minArgs: 0,
                            // NORMALIZATION: Legacy macros are usually external/custom, so not protected.
                            isProtected: false,
                            def: null,
                        });
                        legacyCount++;
                    }
                }
            }
            console.debug(`[SliderMacros] Found ${legacyCount} additional macros from legacy parser`);
        } catch (e) {
            console.warn('[SliderMacros] Failed to get macros from legacy parser:', e);
        }
    }

    console.debug(`[SliderMacros] Total macros available: ${macroMap.size}`);
    return Array.from(macroMap.values());
}

/**
 * Gets all known variables from both local and global scopes.
 * @returns Array of MacroInfo objects representing variables
 */
function getAllKnownVariables(): MacroInfo[] {
    const variableList: MacroInfo[] = [];

    if (!variables) {
        console.debug('[SliderMacros] Variables API not available');
        return variableList;
    }

    // Get local variables
    try {
        if (variables.local?.keys) {
            const localKeys = variables.local.keys();
            for (const key of localKeys) {
                const value = variables.local.get(key);
                variableList.push({
                    name: key,
                    description: `Local variable`,
                    source: 'variable',
                    sourceName: 'local',
                    category: 'variable',
                    minArgs: 0,
                    isProtected: false,
                    isVariable: true,
                    variableScope: 'local',
                    variableValue: value,
                });
            }
        } else if (variables.local && typeof variables.local[Symbol.iterator] === 'function') {
            for (const [key, value] of variables.local) {
                variableList.push({
                    name: key,
                    description: `Local variable`,
                    source: 'variable',
                    sourceName: 'local',
                    category: 'variable',
                    minArgs: 0,
                    isProtected: false,
                    isVariable: true,
                    variableScope: 'local',
                    variableValue: value,
                });
            }
        }
    } catch (e) {
        console.warn('[SliderMacros] Failed to get local variables:', e);
    }

    // Get global variables
    try {
        if (variables.global?.keys) {
            const globalKeys = variables.global.keys();
            for (const key of globalKeys) {
                const value = variables.global.get(key);
                variableList.push({
                    name: key,
                    description: `Global variable`,
                    source: 'variable',
                    sourceName: 'global',
                    category: 'variable',
                    minArgs: 0,
                    isProtected: false,
                    isVariable: true,
                    variableScope: 'global',
                    variableValue: value,
                });
            }
        } else if (variables.global && typeof variables.global[Symbol.iterator] === 'function') {
            for (const [key, value] of variables.global) {
                variableList.push({
                    name: key,
                    description: `Global variable`,
                    source: 'variable',
                    sourceName: 'global',
                    category: 'variable',
                    minArgs: 0,
                    isProtected: false,
                    isVariable: true,
                    variableScope: 'global',
                    variableValue: value,
                });
            }
        }
    } catch (e) {
        console.warn('[SliderMacros] Failed to get global variables:', e);
    }

    console.debug(`[SliderMacros] Total variables available: ${variableList.length}`);
    return variableList;
}

/**
 * Gets "simple value" macros that can be overridden by sliders.
 * Filters out:
 * 1. Macros that require arguments (like {{getvar::name}})
 * 2. Utility/Setter macros (like {{noop}}, {{newline}}, {{setvar}})
 * @returns Filtered array of simple value macros
 */
function getSimpleValueMacros(): MacroInfo[] {
    const allMacros = getAllKnownMacros();

    return allMacros.filter(macro => {
        // 1. Must be callable without arguments (e.g. {{name}})
        // This filters out setters like {{setvar::k::v}} and getters like {{getvar::k}}
        if (macro.minArgs > 0) return false;

        // 2. Exclude Utility category (noop, newline, trim, if, else, etc.)
        const category = macro.category?.toLowerCase?.() || macro.category;
        if (category === 'utility' || category === 'UTILITY') return false;

        return true;
    });
}

/**
 * Searches macros and optionally variables by name or description.
 * Only searches "simple value" macros that can be overridden.
 * @param query - Search query string
 * @param limit - Maximum number of results
 * @param includeVariables - Whether to include variables in results
 * @returns Filtered array of macro info objects
 */
function searchMacros(query: string, limit = 20, includeVariables = false): MacroInfo[] {
    const simpleMacros = getSimpleValueMacros();
    const allItems = includeVariables ? [...simpleMacros, ...getAllKnownVariables()] : simpleMacros;
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
        return allItems.slice(0, limit);
    }

    return allItems
        .filter(m =>
            m.name.toLowerCase().includes(lowerQuery) ||
            m.description.toLowerCase().includes(lowerQuery)
        )
        .slice(0, limit);
}

/**
 * Shows a popup dialog for searching and selecting existing macros and optionally variables.
 * @param includeVariables - Whether to include variables in search results
 * @returns Promise resolving to selected macro info, or null if cancelled
 */
async function showMacroSearchPopup(includeVariables = false): Promise<MacroInfo | null> {
    return new Promise((resolve) => {
        let selectedMacro: MacroInfo | null = null;

        // Build initial HTML
        const title = includeVariables ? 'Search Macros & Variables' : 'Search Existing Macros (Power Users Only!)';
        const placeholder = includeVariables ? 'Search macros and variables...' : 'Search macros by name or description...';
        const initialHtml = `
            <div class="slider_macros_search_container">
                <div class="slider_macros_search_description">
                    <p class="pulse_opacity">This will let you search for existing macros and remap them to slider values, even core Sillytavern Macros. This is not recommended for beginners, as it can cause unexpected behavior.<br>This can easily be undone by simply setting a different variable/macro name for the slider and refreshing sillytavern.</p>
                </div>
                <div class="slider_macros_search_input_row">
                    <input type="text" class="text_pole slider_macros_search_input" placeholder="${placeholder}">
                </div>
                <div class="slider_macros_search_results">
                    <div class="slider_macros_search_empty">Loading...</div>
                </div>
            </div>
        `;

        const renderResults = (query: string, resultsContainer: HTMLElement) => {
            const results = searchMacros(query, 50, includeVariables);
            resultsContainer.innerHTML = '';

            if (results.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'slider_macros_search_empty';
                empty.textContent = query ? 'No results found matching your search.' : 'No macros or variables available.';
                resultsContainer.appendChild(empty);
                return;
            }

            results.forEach(macro => {
                const resultItem = document.createElement('div');
                resultItem.className = 'slider_macros_search_result';
                if (macro.isProtected) {
                    resultItem.classList.add('protected');
                }
                if (macro.isVariable) {
                    resultItem.classList.add('variable');
                }

                const nameRow = document.createElement('div');
                nameRow.className = 'slider_macros_search_result_header';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'slider_macros_search_result_name';
                // Variables don't use {{}} syntax in display
                nameSpan.textContent = macro.isVariable ? macro.name : `{{${macro.name}}}`;
                nameRow.appendChild(nameSpan);

                // Source badge (Core/Extension/Legacy/Variable)
                const sourceSpan = document.createElement('span');
                let sourceClass = 'extension';
                let sourceText = macro.sourceName || 'Extension';

                if (macro.isVariable) {
                    sourceClass = 'variable';
                    sourceText = macro.variableScope === 'global' ? 'Global Var' : 'Local Var';
                } else if (macro.source === 'core') {
                    sourceClass = 'core';
                    sourceText = 'Core';
                } else if (macro.source === 'legacy') {
                    sourceClass = 'legacy';
                    sourceText = 'Legacy';
                }

                sourceSpan.className = `slider_macros_search_result_source ${sourceClass}`;
                sourceSpan.textContent = sourceText;
                nameRow.appendChild(sourceSpan);

                // Protected badge
                if (macro.isProtected) {
                    const protectedSpan = document.createElement('span');
                    protectedSpan.className = 'slider_macros_search_result_protected';
                    protectedSpan.textContent = 'Protected';
                    protectedSpan.title = 'This is a core macro. Overriding it may cause unexpected behavior.';
                    nameRow.appendChild(protectedSpan);
                }

                resultItem.appendChild(nameRow);

                if (macro.description) {
                    const descSpan = document.createElement('div');
                    descSpan.className = 'slider_macros_search_result_desc';
                    descSpan.textContent = macro.description;
                    resultItem.appendChild(descSpan);
                }

                // Show current value
                try {
                    let currentValue: string;
                    if (macro.isVariable) {
                        currentValue = String(macro.variableValue ?? '');
                    } else {
                        currentValue = getMacroValue(macro.name);
                        if (currentValue === `{{${macro.name}}}`) {
                            currentValue = '';
                        }
                    }

                    if (currentValue) {
                        const valueSpan = document.createElement('div');
                        valueSpan.className = 'slider_macros_search_result_value';
                        const displayValue = currentValue.length > 50 ? currentValue.substring(0, 50) + '...' : currentValue;
                        valueSpan.textContent = `Current: ${displayValue}`;
                        resultItem.appendChild(valueSpan);
                    }
                } catch {
                    // Ignore errors getting value
                }

                resultItem.addEventListener('click', () => {
                    selectedMacro = macro;
                    // Close popup by clicking the confirm button
                    const confirmBtn = document.querySelector('.popup-button-ok') as HTMLButtonElement;
                    if (confirmBtn) confirmBtn.click();
                });

                resultsContainer.appendChild(resultItem);
            });
        };

        // Show popup
        Popup.show.confirm(title, initialHtml, {
            okButton: 'Select',
            cancelButton: 'Cancel',
        }).then((confirmed: boolean) => {
            if (confirmed && selectedMacro) {
                resolve(selectedMacro);
            } else {
                resolve(null);
            }
        });

        // After popup opens, attach event listeners
        setTimeout(() => {
            const searchInput = document.querySelector('.slider_macros_search_input') as HTMLInputElement;
            const resultsContainer = document.querySelector('.slider_macros_search_results') as HTMLDivElement;

            if (searchInput && resultsContainer) {
                // Initial render
                renderResults('', resultsContainer);

                // Debounced search
                let searchTimeout: ReturnType<typeof setTimeout> | null = null;
                searchInput.addEventListener('input', () => {
                    if (searchTimeout) clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        renderResults(searchInput.value, resultsContainer);
                    }, 150);
                });

                // Focus search input
                searchInput.focus();
            }
        }, 50);
    });
}

// ============================================================================
// End Universal Macro System Handler
// ============================================================================

// ============================================================================
// Variables API Helpers
// ============================================================================

/**
 * Gets a variable value using the direct variables API.
 * Preferred over macro evaluation for variables to avoid parsing overhead.
 * @param name - Variable name (without getvar:: prefix)
 * @param scope - 'local' or 'global' (default: 'local')
 * @returns The variable value, or undefined if not set
 */
function getVariableValue(name: string, scope: 'local' | 'global' = 'local'): unknown {
    if (!variables) {
        console.warn('[SliderMacros] Variables API not available');
        return undefined;
    }

    try {
        const varScope = scope === 'global' ? variables.global : variables.local;
        if (varScope?.get) {
            return varScope.get(name);
        }
    } catch (e) {
        console.warn(`[SliderMacros] Failed to get variable "${name}":`, e);
    }
    return undefined;
}

/**
 * Sets a variable value using the direct variables API.
 * Preferred over macro evaluation for variables.
 * @param name - Variable name (without setvar:: prefix)
 * @param value - The value to set (any type supported)
 * @param scope - 'local' or 'global' (default: 'local')
 * @returns True if successful
 */
function setVariableValue(name: string, value: unknown, scope: 'local' | 'global' = 'local'): boolean {
    if (!variables) {
        console.warn('[SliderMacros] Variables API not available');
        return false;
    }

    try {
        const varScope = scope === 'global' ? variables.global : variables.local;
        if (varScope?.set) {
            varScope.set(name, value);
            return true;
        }
    } catch (e) {
        console.warn(`[SliderMacros] Failed to set variable "${name}":`, e);
    }
    return false;
}

/**
 * Checks if a variable exists in a specific scope.
 * @param name - Variable name
 * @param scope - 'local' or 'global' (default: 'local')
 * @returns True if the variable exists in the specified scope
 */
function hasVariable(name: string, scope: 'local' | 'global' = 'local'): boolean {
    if (!variables) return false;

    try {
        const varScope = scope === 'global' ? variables.global : variables.local;
        if (varScope?.has) {
            return varScope.has(name);
        }
    } catch (e) {
        console.warn(`[SliderMacros] Failed to check variable "${name}":`, e);
    }
    return false;
}

/**
 * Checks if a variable exists in any scope (local first, then global).
 * Uses resolveVariable from ST which returns the name itself if not found.
 * @param name - Variable name
 * @returns Object with exists flag and the scope where it was found
 */
function findVariable(name: string): { exists: boolean; scope: 'local' | 'global' | null; value: unknown } {
    // Check local first
    if (hasVariable(name, 'local')) {
        return { exists: true, scope: 'local', value: getVariableValue(name, 'local') };
    }
    // Check global
    if (hasVariable(name, 'global')) {
        return { exists: true, scope: 'global', value: getVariableValue(name, 'global') };
    }
    // Fallback: use resolveVariable if available (checks scope → local → global)
    if (typeof resolveVariable === 'function') {
        const resolved = resolveVariable(name);
        // resolveVariable returns the name itself if not found
        if (resolved !== name) {
            // Variable exists but we don't know which scope - check both again
            return { exists: true, scope: null, value: resolved };
        }
    }
    return { exists: false, scope: null, value: undefined };
}

/**
 * Evaluates a string that may contain nested macros.
 * For Macros 2.0: Uses engine.evaluate() which handles nesting natively.
 * For Legacy: Uses substituteParams() which may need multiple passes for deep nesting.
 * @param template - String potentially containing macro syntax (e.g., "{{pick::A::B}}")
 * @returns The evaluated result
 */
function evaluateNestedMacros(template: string): string {
    if (!template || !template.includes('{{')) {
        return template;
    }

    // 1. If experimental engine is enabled, use native nested evaluation
    if (power_user?.experimental_macro_engine && macros?.engine) {
        try {
            const env = macros.envBuilder?.buildFromRawEnv({});
            if (env) {
                return macros.engine.evaluate(template, env);
            }
        } catch (e) {
            console.warn('[SliderMacros] Failed to evaluate nested macros with 2.0 engine:', e);
        }
    }

    // 2. Legacy fallback: Use substituteParams with multiple passes for nested macros
    if (typeof substituteParams === 'function') {
        let result = template;
        let prevResult = '';
        let maxIterations = 5; // Prevent infinite loops

        // Keep substituting until no more changes or max iterations
        while (result !== prevResult && maxIterations > 0) {
            prevResult = result;
            result = substituteParams(result);
            maxIterations--;
        }

        return result;
    }

    return template;
}

/**
 * Sets a variable to the evaluated result of a macro template.
 * Evaluates nested macros first, then sets the final value.
 * @param varName - Variable name to set
 * @param template - Template string (may contain nested macros)
 * @param scope - 'local' or 'global'
 * @returns The evaluated value that was set
 */
function setVariableFromTemplate(varName: string, template: string, scope: 'local' | 'global' = 'local'): string {
    const evaluatedValue = evaluateNestedMacros(template);
    setVariableValue(varName, evaluatedValue, scope);
    return evaluatedValue;
}

/**
 * Syncs a slider's value to its bound variable if sync is enabled and configured.
 * Only syncs to EXISTING variables - will not create new ones.
 * @param slider - The slider model to sync
 * @returns True if sync was successful, false if disabled or variable doesn't exist
 */
function syncSliderToVariable(slider: SliderModel): boolean {
    if (!slider.syncEnabled || !slider.syncVariable) {
        return false;
    }

    const scope = slider.syncScope || 'local';

    // Only sync to existing variables
    if (!hasVariable(slider.syncVariable, scope)) {
        console.debug(`[SliderMacros] Skipping sync - variable "${slider.syncVariable}" does not exist in ${scope} scope`);
        return false;
    }

    setVariableValue(slider.syncVariable, slider.value, scope);
    console.debug(`[SliderMacros] Synced slider "${slider.name}" value to ${scope} variable "${slider.syncVariable}":`, slider.value);
    return true;
}

// ============================================================================
// End Variables API Helpers
// ============================================================================

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
    order: number;
    // Variable sync fields
    syncEnabled: boolean;
    syncVariable: string;
    syncScope: 'local' | 'global';
}

interface SliderGroup {
    id: string;
    name: string;
    collapsed: boolean;
    order: number;
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

function getNextOrder(collection: SliderCollection): number {
    const groupOrders = collection.groups.map(g => g.order);
    const ungroupedSliderOrders = collection.sliders.filter(s => !s.groupId).map(s => s.order);
    const allOrders = [...groupOrders, ...ungroupedSliderOrders];
    return allOrders.length > 0 ? Math.max(...allOrders) + 1 : 0;
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

        // Migration: Add order to groups that don't have it
        let maxGroupOrder = -1;
        for (const group of collection.groups) {
            if (group.order === undefined) {
                group.order = collection.groups.indexOf(group);
            }
            maxGroupOrder = Math.max(maxGroupOrder, group.order);
        }

        // Migration: Add groupId and order to sliders that don't have them
        let maxSliderOrder = maxGroupOrder;
        for (const slider of collection.sliders) {
            if (slider.groupId === undefined) {
                slider.groupId = null;
            }
            if (slider.order === undefined) {
                // Ungrouped sliders get order after groups, grouped sliders get order within their group context
                maxSliderOrder++;
                slider.order = maxSliderOrder;
            } else {
                maxSliderOrder = Math.max(maxSliderOrder, slider.order);
            }
            // Migration: Add variable sync fields
            if ((slider as any).syncEnabled === undefined) {
                // Migrate from old field names if they exist
                const oldSyncToVariable = (slider as any).syncToVariable;
                const oldVariableSource = (slider as any).variableSource;

                // Enable sync if old syncToVariable was true OR if there was a variableSource set
                slider.syncEnabled = oldSyncToVariable === true || (oldVariableSource && oldVariableSource.trim() !== '');
                slider.syncVariable = (slider as any).syncVariable || oldVariableSource || '';
                slider.syncScope = (slider as any).syncScope || (slider as any).variableScope || 'local';

                // Clean up old fields
                delete (slider as any).variableSource;
                delete (slider as any).variableScope;
                delete (slider as any).syncToVariable;
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
        order: getNextOrder(activeCollection),
        syncEnabled: false,
        syncVariable: '',
        syncScope: 'local',
    });

    saveSettingsDebounced();
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
        order: getNextOrder(activeCollection),
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

    // Helper function to create a slider card element
    const createSliderCard = (slider: SliderModel, index: number): DocumentFragment => {
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

        // Macro search elements
        const searchMacroButton = renderer.content.querySelector('button[name="searchMacro"]') as HTMLButtonElement;
        const macroStatusElement = renderer.content.querySelector('.slider_macros_macro_status') as HTMLDivElement;

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

        // Hide group badge for grouped sliders (they're already inside the group)
        // Show it only for ungrouped sliders that were previously in a group
        if (cardGroupBadge) {
            cardGroupBadge.dataset.visible = 'false';
        }

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

        // Event listener for group change - re-render entire settings panel to move slider
        if (groupIdSelect) {
            groupIdSelect.addEventListener('change', () => {
                slider.groupId = groupIdSelect.value || null;
                saveSettingsDebounced();
                renderSliderConfigs(settings);
            });
        }

        nameInput.addEventListener('input', () => {
            slider.name = nameInput.value;
            cardNameDisplay.textContent = slider.name || 'New Slider';
            debouncedRender();
            debouncedSaveSettings();
        });

        propertyInput.addEventListener('input', () => {
            slider.property = propertyInput.value;
            cardMacroDisplay.textContent = slider.property || '';
            updateMacroStatus();
            debouncedRender();
            debouncedSaveSettings();
        });

        // Macro status indicator - shows if macro already exists and if it's protected
        const updateMacroStatus = () => {
            if (!macroStatusElement) return;
            const macroName = propertyInput.value.trim();
            if (!macroName) {
                macroStatusElement.textContent = '';
                macroStatusElement.className = 'slider_macros_macro_status';
                return;
            }

            // Use cached protected status to avoid issues with our slider overriding core macros
            const isProtected = isProtectedMacro(macroName);

            // Check if macro exists (either in registry or resolves to a value)
            const macroExists = hasMacro(macroName);

            if (isProtected) {
                // Always show as protected if it was originally a core macro
                const currentValue = getMacroValue(macroName);
                const displayValue = currentValue.length > 30 ? currentValue.substring(0, 30) + '...' : currentValue;
                macroStatusElement.textContent = `⚠ Overrides PROTECTED core macro (current: ${displayValue})`;
                macroStatusElement.className = 'slider_macros_macro_status protected';
            } else if (macroExists) {
                const currentValue = getMacroValue(macroName);
                const displayValue = currentValue.length > 30 ? currentValue.substring(0, 30) + '...' : currentValue;
                macroStatusElement.textContent = `Overrides existing macro (current: ${displayValue})`;
                macroStatusElement.className = 'slider_macros_macro_status exists';
            } else {
                macroStatusElement.textContent = 'New macro will be created';
                macroStatusElement.className = 'slider_macros_macro_status available';
            }
        };

        // Initial status check
        updateMacroStatus();

        // Search macro button - opens popup to search and select existing macros
        if (searchMacroButton) {
            searchMacroButton.addEventListener('click', async () => {
                const selectedMacro = await showMacroSearchPopup();
                if (selectedMacro) {
                    propertyInput.value = selectedMacro.name;
                    slider.property = selectedMacro.name;
                    cardMacroDisplay.textContent = selectedMacro.name;
                    // Auto-fill name if empty
                    if (!slider.name || slider.name === 'New Slider') {
                        const prettyName = selectedMacro.name
                            .replace(/[_-]/g, ' ')
                            .replace(/\b\w/g, c => c.toUpperCase());
                        nameInput.value = prettyName;
                        slider.name = prettyName;
                        cardNameDisplay.textContent = prettyName;
                    }
                    updateMacroStatus();
                    renderCompletionSliders(settings);
                    saveSettingsDebounced();
                }
            });
        }

        // Variable sync elements
        const syncEnabledCheckbox = renderer.content.querySelector('input[name="syncEnabled"]') as HTMLInputElement;
        const variableConfigSection = renderer.content.querySelector('.slider_macros_variable_config') as HTMLDivElement;
        const syncVariableInput = renderer.content.querySelector('input[name="syncVariable"]') as HTMLInputElement;
        const syncScopeSelect = renderer.content.querySelector('select[name="syncScope"]') as HTMLSelectElement;
        const searchVariableButton = renderer.content.querySelector('button[name="searchVariable"]') as HTMLButtonElement;
        const variableStatusElement = renderer.content.querySelector('.slider_macros_variable_status') as HTMLDivElement;

        // Set initial values for variable sync
        if (syncEnabledCheckbox) syncEnabledCheckbox.checked = slider.syncEnabled || false;
        if (syncVariableInput) syncVariableInput.value = slider.syncVariable || '';
        if (syncScopeSelect) syncScopeSelect.value = slider.syncScope || 'local';

        // Show/hide variable config based on syncEnabled
        const updateVariableConfigVisibility = () => {
            if (variableConfigSection) {
                variableConfigSection.style.display = slider.syncEnabled ? 'block' : 'none';
            }
        };
        updateVariableConfigVisibility();

        // Sync enabled checkbox handler
        if (syncEnabledCheckbox) {
            syncEnabledCheckbox.addEventListener('change', () => {
                slider.syncEnabled = syncEnabledCheckbox.checked;
                updateVariableConfigVisibility();
                debouncedSaveSettings();
            });
        }

        // Variable status update function
        const updateVariableStatus = () => {
            if (!variableStatusElement) return;
            const varName = syncVariableInput?.value.trim() || '';
            const scope = syncScopeSelect?.value as 'local' | 'global' || 'local';

            if (!varName) {
                variableStatusElement.textContent = '';
                variableStatusElement.className = 'slider_macros_variable_status';
                return;
            }

            if (hasVariable(varName, scope)) {
                const currentValue = getVariableValue(varName, scope);
                const displayValue = String(currentValue).length > 30 ? String(currentValue).substring(0, 30) + '...' : String(currentValue);
                variableStatusElement.textContent = `✓ Variable exists (current: ${displayValue})`;
                variableStatusElement.className = 'slider_macros_variable_status found';
            } else {
                // Check if it exists in the other scope
                const otherScope = scope === 'local' ? 'global' : 'local';
                if (hasVariable(varName, otherScope)) {
                    variableStatusElement.textContent = `⚠ Variable exists in ${otherScope} scope, not ${scope}`;
                    variableStatusElement.className = 'slider_macros_variable_status not-found';
                } else {
                    variableStatusElement.textContent = '✗ Variable does not exist - sync will be skipped';
                    variableStatusElement.className = 'slider_macros_variable_status not-found';
                }
            }
        };

        // Initial variable status check
        updateVariableStatus();

        // Sync variable input handler
        if (syncVariableInput) {
            syncVariableInput.addEventListener('input', () => {
                slider.syncVariable = syncVariableInput.value;
                updateVariableStatus();
                debouncedSaveSettings();
            });
        }

        // Sync scope select handler
        if (syncScopeSelect) {
            syncScopeSelect.addEventListener('change', () => {
                slider.syncScope = syncScopeSelect.value as 'local' | 'global';
                updateVariableStatus();
                debouncedSaveSettings();
            });
        }

        // Search variable button - opens popup to search and select variables
        if (searchVariableButton) {
            searchVariableButton.addEventListener('click', async () => {
                const selectedItem = await showMacroSearchPopup(true); // true = include variables
                if (selectedItem && selectedItem.isVariable) {
                    if (syncVariableInput) syncVariableInput.value = selectedItem.name;
                    if (syncScopeSelect) syncScopeSelect.value = selectedItem.variableScope || 'local';
                    slider.syncVariable = selectedItem.name;
                    slider.syncScope = selectedItem.variableScope as 'local' | 'global' || 'local';
                    updateVariableStatus();
                    saveSettingsDebounced();
                } else if (selectedItem) {
                    // Selected a macro, fill in property field instead
                    propertyInput.value = selectedItem.name;
                    slider.property = selectedItem.name;
                    cardMacroDisplay.textContent = selectedItem.name;
                    updateMacroStatus();
                    saveSettingsDebounced();
                }
            });
        }

        // Duplicate button
        const duplicateButton = renderer.content.querySelector('button[name="duplicate"]') as HTMLButtonElement;
        if (duplicateButton) {
            duplicateButton.addEventListener('click', () => {
                const activeCollection = settings.collections.find(c => c.active);
                if (!activeCollection) return;

                // Deep clone the slider
                const newSlider: SliderModel = {
                    ...slider,
                    name: `${slider.name} Copy`,
                    property: '', // Leave macro empty for user to set
                    order: getNextOrder(activeCollection),
                    // Clone arrays/objects to avoid shared references
                    options: [...(slider.options || [])],
                    dropdownOptions: (slider.dropdownOptions || []).map(o => ({ ...o })),
                };

                activeCollection.sliders.push(newSlider);
                renderSliderConfigs(settings);
                saveSettingsDebounced();
            });
        }

        minInput.addEventListener('input', () => {
            slider.min = minInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        maxInput.addEventListener('input', () => {
            slider.max = maxInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        stepInput.addEventListener('input', () => {
            slider.step = stepInput.value;
            debouncedRender();
            debouncedSaveSettings();
        });

        enableCheckbox.addEventListener('change', () => {
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
            const activeCollection = settings.collections.find(c => c.active);
            if (!activeCollection) {
                return;
            }

            if (slider.groupId) {
                // Grouped slider: reorder within group
                const groupSliders = activeCollection.sliders
                    .filter(s => s.groupId === slider.groupId)
                    .sort((a, b) => a.order - b.order);
                const currentIdx = groupSliders.findIndex(s => s === slider);
                if (currentIdx > 0) {
                    const prevSlider = groupSliders[currentIdx - 1];
                    const tempOrder = slider.order;
                    slider.order = prevSlider.order;
                    prevSlider.order = tempOrder;
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            } else {
                // Ungrouped slider: reorder in unified list
                const items: { order: number; isGroup: boolean; ref: SliderModel | SliderGroup }[] = [];
                activeCollection.groups.forEach(g => items.push({ order: g.order, isGroup: true, ref: g }));
                activeCollection.sliders.filter(s => !s.groupId).forEach(s => items.push({ order: s.order, isGroup: false, ref: s as SliderModel }));
                items.sort((a, b) => a.order - b.order);

                const currentIdx = items.findIndex(i => !i.isGroup && i.ref === slider);
                if (currentIdx > 0) {
                    const prevItem = items[currentIdx - 1];
                    const tempOrder = slider.order;
                    slider.order = prevItem.ref.order;
                    prevItem.ref.order = tempOrder;
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            }
        });

        downButton.addEventListener('click', () => {
            const activeCollection = settings.collections.find(c => c.active);
            if (!activeCollection) {
                return;
            }

            if (slider.groupId) {
                // Grouped slider: reorder within group
                const groupSliders = activeCollection.sliders
                    .filter(s => s.groupId === slider.groupId)
                    .sort((a, b) => a.order - b.order);
                const currentIdx = groupSliders.findIndex(s => s === slider);
                if (currentIdx < groupSliders.length - 1) {
                    const nextSlider = groupSliders[currentIdx + 1];
                    const tempOrder = slider.order;
                    slider.order = nextSlider.order;
                    nextSlider.order = tempOrder;
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            } else {
                // Ungrouped slider: reorder in unified list
                const items: { order: number; isGroup: boolean; ref: SliderModel | SliderGroup }[] = [];
                activeCollection.groups.forEach(g => items.push({ order: g.order, isGroup: true, ref: g }));
                activeCollection.sliders.filter(s => !s.groupId).forEach(s => items.push({ order: s.order, isGroup: false, ref: s as SliderModel }));
                items.sort((a, b) => a.order - b.order);

                const currentIdx = items.findIndex(i => !i.isGroup && i.ref === slider);
                if (currentIdx < items.length - 1) {
                    const nextItem = items[currentIdx + 1];
                    const tempOrder = slider.order;
                    slider.order = nextItem.ref.order;
                    nextItem.ref.order = tempOrder;
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            }
        });

        return renderer.content;
    };

    // Build unified list of items (groups and ungrouped sliders) sorted by order
    type RenderItem =
        | { type: 'group'; group: SliderGroup; groupIndex: number }
        | { type: 'slider'; slider: SliderModel; sliderIndex: number };

    const renderItems: RenderItem[] = [];

    // Add groups
    activeCollection.groups.forEach((group, groupIndex) => {
        renderItems.push({ type: 'group', group, groupIndex });
    });

    // Add ungrouped sliders
    activeCollection.sliders.forEach((slider, sliderIndex) => {
        if (!slider.groupId) {
            renderItems.push({ type: 'slider', slider, sliderIndex });
        }
    });

    // Sort by order
    renderItems.sort((a, b) => {
        const orderA = a.type === 'group' ? a.group.order : a.slider.order;
        const orderB = b.type === 'group' ? b.group.order : b.slider.order;
        return orderA - orderB;
    });

    // Helper to get sorted items for reordering
    const getOrderedItems = (): { order: number; isGroup: boolean; id: string }[] => {
        const items: { order: number; isGroup: boolean; id: string }[] = [];
        activeCollection.groups.forEach(g => items.push({ order: g.order, isGroup: true, id: g.id }));
        activeCollection.sliders.filter(s => !s.groupId).forEach(s => items.push({ order: s.order, isGroup: false, id: s.property }));
        return items.sort((a, b) => a.order - b.order);
    };

    // Render items in order
    renderItems.forEach((item) => {
        if (item.type === 'slider') {
            const sliderCard = createSliderCard(item.slider, item.sliderIndex);
            elements.list.appendChild(sliderCard);
        } else {
            const { group, groupIndex } = item;
            const renderer = document.createElement('template');
            renderer.innerHTML = groupTemplate;

            const card = renderer.content.querySelector('.slider_macros_group_card') as HTMLDivElement;
            const cardHeader = renderer.content.querySelector('.slider_macros_group_card_header') as HTMLDivElement;
            const cardNameDisplay = renderer.content.querySelector('.slider_macros_group_card_name') as HTMLSpanElement;
            const cardCountDisplay = renderer.content.querySelector('.slider_macros_group_card_count') as HTMLSpanElement;
            const groupSlidersContainer = renderer.content.querySelector('.slider_macros_group_sliders') as HTMLDivElement;

            const nameInput = renderer.content.querySelector('input[name="groupName"]') as HTMLInputElement;
            const deleteButton = renderer.content.querySelector('button[name="deleteGroup"]') as HTMLButtonElement;
            const upButton = renderer.content.querySelector('button[name="up"]') as HTMLButtonElement;
            const downButton = renderer.content.querySelector('button[name="down"]') as HTMLButtonElement;

            // Get sliders in this group, sorted by their order
            const slidersInGroup = activeCollection.sliders
                .map((s, i) => ({ slider: s, index: i }))
                .filter(item => item.slider.groupId === group.id)
                .sort((a, b) => a.slider.order - b.slider.order);

            // Set initial values
            card.dataset.groupId = group.id;
            cardNameDisplay.textContent = group.name || 'New Group';
            cardCountDisplay.textContent = `(${slidersInGroup.length} slider${slidersInGroup.length !== 1 ? 's' : ''})`;
            nameInput.value = group.name;

            // Render sliders inside the group
            slidersInGroup.forEach(({ slider, index }) => {
                const sliderCard = createSliderCard(slider, index);
                groupSlidersContainer.appendChild(sliderCard);
            });

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

            // Move up - swap order with previous item
            upButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const orderedItems = getOrderedItems();
                const currentIdx = orderedItems.findIndex(i => i.isGroup && i.id === group.id);
                if (currentIdx > 0) {
                    const prevItem = orderedItems[currentIdx - 1];
                    const currentOrder = group.order;
                    // Swap orders
                    if (prevItem.isGroup) {
                        const prevGroup = activeCollection.groups.find(g => g.id === prevItem.id);
                        if (prevGroup) {
                            group.order = prevGroup.order;
                            prevGroup.order = currentOrder;
                        }
                    } else {
                        const prevSlider = activeCollection.sliders.find(s => s.property === prevItem.id && !s.groupId);
                        if (prevSlider) {
                            group.order = prevSlider.order;
                            prevSlider.order = currentOrder;
                        }
                    }
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            });

            // Move down - swap order with next item
            downButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const orderedItems = getOrderedItems();
                const currentIdx = orderedItems.findIndex(i => i.isGroup && i.id === group.id);
                if (currentIdx < orderedItems.length - 1) {
                    const nextItem = orderedItems[currentIdx + 1];
                    const currentOrder = group.order;
                    // Swap orders
                    if (nextItem.isGroup) {
                        const nextGroup = activeCollection.groups.find(g => g.id === nextItem.id);
                        if (nextGroup) {
                            group.order = nextGroup.order;
                            nextGroup.order = currentOrder;
                        }
                    } else {
                        const nextSlider = activeCollection.sliders.find(s => s.property === nextItem.id && !s.groupId);
                        if (nextSlider) {
                            group.order = nextSlider.order;
                            nextSlider.order = currentOrder;
                        }
                    }
                    renderSliderConfigs(settings);
                    saveSettingsDebounced();
                }
            });

            elements.list.appendChild(renderer.content);
        }
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
                syncSliderToVariable(slider);
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

                syncSliderToVariable(slider);
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
                syncSliderToVariable(slider);
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
                    syncSliderToVariable(slider);
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

                // Create centered wrapper for color picker
                const colorWrapper = document.createElement('div');
                colorWrapper.className = 'slider_macros_color_wrapper';

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
                    syncSliderToVariable(slider);
                    saveSettingsDebounced();
                    updateSliderMacros(settings);
                };

                const updateFromHex = () => {
                    let hex = hexDisplay.value.trim();
                    if (!hex.startsWith('#')) hex = '#' + hex;
                    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                        colorInput.value = hex;
                        slider.value = hex;
                        syncSliderToVariable(slider);
                        saveSettingsDebounced();
                        updateSliderMacros(settings);
                    }
                };

                colorInput.addEventListener('input', updateFromColor);
                hexDisplay.addEventListener('change', updateFromHex);

                colorWrapper.appendChild(colorInput);
                colorWrapper.appendChild(hexDisplay);
                rangeContainer.appendChild(colorWrapper);
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
                    syncSliderToVariable(slider);
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

    // Build unified list of items (groups and ungrouped sliders) sorted by order
    type CompletionRenderItem =
        | { type: 'group'; group: SliderGroup }
        | { type: 'slider'; slider: SliderModel };

    const completionItems: CompletionRenderItem[] = [];

    // Add groups (only if they have enabled sliders)
    activeCollection.groups.forEach((group) => {
        const slidersInGroup = activeCollection.sliders.filter(s => s.groupId === group.id);
        const enabledCount = slidersInGroup.filter(s => s.enabled && s.property && s.name).length;
        if (enabledCount > 0) {
            completionItems.push({ type: 'group', group });
        }
    });

    // Add ungrouped sliders (only if enabled)
    activeCollection.sliders.forEach((slider) => {
        if (!slider.groupId && slider.enabled && slider.property && slider.name) {
            completionItems.push({ type: 'slider', slider });
        }
    });

    // Sort by order
    completionItems.sort((a, b) => {
        const orderA = a.type === 'group' ? a.group.order : a.slider.order;
        const orderB = b.type === 'group' ? b.group.order : b.slider.order;
        return orderA - orderB;
    });

    // Render items in order
    completionItems.forEach((item) => {
        if (item.type === 'slider') {
            renderSliderToContainer(item.slider, container);
        } else {
            const group = item.group;
            const slidersInGroup = activeCollection.sliders
                .filter(s => s.groupId === group.id)
                .sort((a, b) => a.order - b.order);

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
        }
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
    // Initialize protected macros cache FIRST, before any slider registration
    initProtectedMacrosCache();

    const settings = getSettings();
    addSettingsControls(settings);
    renderCompletionSliders(settings);
    setupEventHandlers(settings);
    observer.observe(document.body, { childList: true, subtree: true });
    saveSettingsDebounced();
})();
