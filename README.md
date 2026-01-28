# Slider Macros

Adds customizable slider (and others) controls for Sillytavern {{macros}} in the Chat Completion panel. Extension by Landozo and [Prolix-OC](https://github.com/prolix-oc).

This is a Fork of the Sillytavern [CustomSliders Extension by Cohee1207](https://github.com/SillyTavern/Extension-CustomSliders).

This works with Vanilla themed sillytavern, Moonlit Echoes themed sillytavern, and Nemo's Nemo Preset Extension enabled sillytavern as of January 26, 2026!

## How to install

1. In Sillytavern, in the extensions menu (--insert icon--), click the install extension button on the upper right.

--Insert Image of extension menu and install extension button--

2. In the new dialog, insert the url of this page and hit install for me or install for all users: 
```https://github.com/Landozo/Extension-SliderMacros```

--Insert Image of the above--

3. Enable the "Experimental Macro Engine" in the user settings.

--Insert Image of the experimental macro engine toggle--

> [!WARNING]
> This extension will not work with the older macro engine! You need to use the experimental one, which requires Sillytavern 1.15 or later!

4. Refresh the page again and you are all set!

## What does this do?

The purpose of this extension is to give the ability to rapidly change the value of setting user {{macros}} in Sillytavern's Macro Engine. Macros can be a numeric value, a boolean value (true or false), a hex value, or a string value; this slider extension allows for selecting and controlling all four in various ways.

### How to set up sliders

1. In the extension settings menu, you will find a Slider Macros menu, open it.
2. Click Create Slider to create a new slider.
3. In the new modal, you have several options:
- Name lets you give the slider a name, which will appear above it in the chat completions panel (more on that later)
- Macro Variable lets you set what {{variable}} the slider will map to.
- Type lets you choose between numeric, boolean, multiselect, dropdown, checkbox, and color. Each option will have different values:
	- Numeric lets you choose a minimum and maximum numeric value and the step value between each "notch" of the slider (So, say 1 to 100, with a value of 5 between each tick).
	- Boolean lets you choose between a dual value slider of true or false. You can choose which is the default value, true or false.
	- Multiselect lets you choose between a slider with 2-4 string values, that you can then select by dragging the slider. An example might be red, blue, green, and yellow, and then you can drag the slider to choose which one.
	- Dropdown lets you make a dropdown box and add customizable values to it. Basically an alternative to the multi-select slider that allows for more options.
	- Color lets you use a color picker to select a hue value. Useful for a macro to set the text value of a character!
	- Checkbox lets you make a checkbox and assign the checked or unchecked value to true or false, basically an alternative to the Boolean slider.
4. Finally you can create a named group of sliders and assign each slider to a group with the group dropdown.

--Insert Image of the slider setup menu--

### How to use the sliders

In the chat completions panel on the left of sillytavern, below the sampler and chat completions settings, but above the prompt manager, you'll find a collapsible dropdown that expands to show your selected sliders. It also has a dropdown for choosing a collection of sliders (more on that later).

--Insert Image showing the sliders dropdown in the chat completions panel--

You can freely move these sliders around to update your macros in real time.

As for calling the variable macros, simply insert them like so: ```{{testVarA}}``` into your system prompt or lorebook for values that will be "locked in" to the slider set value when you click "send message/generate" in the chat window.

You can also just put them into the chat window itself and they will replace with the value when you hit enter.

--Insert Image showing a {{macro}} in a system prompt toggle--

> [!NOTE]
> Keep in mind that {{macros}} are Sillytavern specific, they are replaced with the values set after being sent to the LLM. To the LLM, a {{variableA}} set to 10, will just look like the number 10. This means your macros will be updated for future prompt sends, but not for past ones!

--Insert Image showing how macros resolve to plain text before going to the llm--

### The Slider Collection System

Above the create slider button in the extension, you'll see a bar that includes a dropdown and various buttons to the right. This is the slider collections system, think of this like presets but for your sliders.

--Insert Image showing the collections bar--

You have the following options here:

- The dropdown can be used to select a collection, these auto-save whenever you change the sliders below
- The folder/plus button to the right of it creates a new collection.
- The import (arrow in) and export (arrow out) buttons allow you to import and export slider collections.
- Lastly, the trash can icon lets you delete a collection (no way to undo this, be careful!).

### The Ever Mysterious Search Existing Macros Button

This button lets Power Users override existing macro values. It has no safeguards, so be careful! We are not responsible for you turning {{Trim}} to be zalgo text and then causing your entire preset to temporarily be spooky!

> [!NOTE]
> If you ever get in a sticky situation, just change the macro to a different non-occupied value and reload to reset the macro to the original sillytavern value!

### Troubleshooting

If any {{Macros}} aren't working for you, make sure you enabled the experimental macro engine!!

## License

AGPL-3.0