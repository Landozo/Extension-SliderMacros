# Slider Macros

Adds customizable slider (and others) controls for Sillytavern {{macros}} in the Chat Completion panel. Extension by Landozo and [Prolix-OC](https://github.com/prolix-oc).

This is a Fork of the Sillytavern [CustomSliders Extension by Cohee1207](https://github.com/SillyTavern/Extension-CustomSliders).

This works with Vanilla themed sillytavern, Moonlit Echoes themed sillytavern, and Nemo's Nemo Preset Extension enabled sillytavern as of January 26, 2026!

## Features

- Customizable Sliders (Numeric, Multiselect, Boolean), checkboxes, hue pickers, and dropdown menus that can be bound to {{macros}} values using a wide variety of settings.
- The ability to control said sliders from a dedicated collapsible menu in the chat completion panel to activately control macro values in real time.
- Grouping system to group sliders into groups for easier navigation!
- Collection/Preset system to save slider macros, allow hotswapping between collections, bind them to a chat completion preset, and allow importing and exporting of slider collections!
- Macros 2.0 functionality out of the box! Also compatible with nemo preset extension and moonlit echoes!
- The ability to sync the macro to any existing variable or SillyTavern macro and allow temporary control of either using the macro slider (easily undoable).

## How to install

1. In Sillytavern, in the extensions menu (<img width="30" height="29" alt="image" src="https://github.com/user-attachments/assets/4645c5f4-81ea-4875-a8dd-0b1da463bb95" />
), click the install extension button on the upper right.

	<img width="427" height="114" alt="image" src="https://github.com/user-attachments/assets/b8e90243-6c10-468c-840d-de99dbb782af" />

2. In the new dialog, insert the url of this page and hit install for me or install for all users: 
```https://github.com/Landozo/Extension-SliderMacros```

	<img width="516" height="403" alt="image" src="https://github.com/user-attachments/assets/3d833ec2-a920-432a-847b-f452c4d47c9f" />

3. Enable the "Experimental Macro Engine" in the user settings (<img width="31" height="28" alt="image" src="https://github.com/user-attachments/assets/0ff44b0b-77d1-470e-8da7-d9e047f5d51d" />) menu.

	<img width="413" height="731" alt="image" src="https://github.com/user-attachments/assets/e020ce7b-f42e-4e78-90e9-8d7c7ad2628f" />

> [!WARNING]
> This extension will not work with the older macro engine! You need to use the experimental one, which requires Sillytavern 1.15 or later!

4. Refresh the page again and you are all set!

## What does this do?

The purpose of this extension is to give the ability to rapidly change the value of customizable user {{macros}} in Sillytavern's Macro Engine. Macros can be a numeric value, a boolean value (true or false), a hex value, or a string value; this slider extension allows for selecting and controlling all four in various ways.

## Usage Instructions

### How to set up sliders

1. In the extension settings menu, you will find a Slider Macros menu, open it.
	
	<img width="618" height="320" alt="image" src="https://github.com/user-attachments/assets/d0ded196-4ac8-4ffe-9294-1fa8a84421f1" />

2. Click Create Slider to create a new slider.
	
	<img width="504" height="153" alt="image" src="https://github.com/user-attachments/assets/e0ce07cc-5f95-4867-b8c4-c6d4c786e2a6" />

4. A new slider item will appear, click it to expand it. After doing so you have several options:
	
	<img width="495" height="513" alt="image" src="https://github.com/user-attachments/assets/9ee4167a-7ac8-4cba-a97b-c61f22e26c29" />

- Name lets you give the slider a name, which will appear above it in the chat completions panel (more on that later)
- Macro Variable lets you set what {{variable}} the slider will map to.
- Type lets you choose between numeric, boolean, multiselect, dropdown, checkbox, and color.
  
	<img width="472" height="218" alt="image" src="https://github.com/user-attachments/assets/a43ac930-2be3-4a2c-a841-a4fad838cf75" />
- There are 5 types:
	- Numeric lets you choose a minimum and maximum numeric value and the step value between each "notch" of the slider (So, say 1 to 100, with a value of 5 between each tick).
	- Boolean lets you choose between a dual value slider of true or false. You can choose which is the default value, true or false.
	- Multiselect lets you choose between a slider with 2-4 string values, that you can then select by dragging the slider. An example might be red, blue, green, and yellow, and then you can drag the slider to choose which one.
	- Dropdown lets you make a dropdown box and add customizable values to it. Basically an alternative to the multi-select slider that allows for more options.
	- Color lets you use a color picker to select a hue value. Useful for a macro to set the text value of a character!
	- Checkbox lets you make a checkbox and assign the checked or unchecked value to true or false, basically an alternative to the Boolean slider.
4. Finally you can create a named group of sliders and assign each slider to a group with the group dropdown.
	
	<img width="531" height="886" alt="image" src="https://github.com/user-attachments/assets/0eedee3e-90f2-4dab-b2cc-58cacf271218" />

In the above example you can see I made a "Test Group" and put two sliders in it using the Group dropdown!

### How to use your sliders

In the chat completions panel on the left of sillytavern, below the sampler and chat completions settings, but above the prompt manager, you'll find a collapsible dropdown that expands to show your selected sliders. It also has a dropdown for choosing a collection of sliders (more on that later).

<img width="333" height="585" alt="image" src="https://github.com/user-attachments/assets/34288696-d2e2-4695-92d1-f8e02e648e0a" />

You can freely move these sliders around to update your macros in real time.
	
<img width="312" height="234" alt="image" src="https://github.com/user-attachments/assets/26450ea6-b891-4cdb-b936-2f6106b0c66a" />

As for calling the variable macros, simply insert them like so: ```{{testVarA}}``` into your system prompt or lorebook for values that will be "locked in" to the slider set value when you click "send message/generate" in the chat window.

You can also just put them into the chat window itself and they will replace with the value when you hit enter.

<img width="738" height="394" alt="image" src="https://github.com/user-attachments/assets/6b3f7cf1-9a23-4748-b113-75764672ef26" />

<img width="467" height="347" alt="image" src="https://github.com/user-attachments/assets/bab2989b-fe91-4b16-ba1f-da7919eb1ae2" />

Above you can see an example where I made a prompt with the {{numVarA}} macro, set it to .56 in the toggle, and sent it as a system prompt, then the llm outputted it as directed.

> [!NOTE]
> Keep in mind that {{macros}} are Sillytavern specific, they are replaced with the values set after being sent to the LLM. To the LLM, a {{variableA}} set to 10, will just look like the number 10. This means your macros will be updated for future prompt sends, but not for past ones! You can see this in the terminal output below. Only the actual value is sent as plaintext to the llm!

<img width="692" height="460" alt="image" src="https://github.com/user-attachments/assets/26862954-58e5-45b7-9295-f621381fbbe9" />

### The Slider Collection System

Above the create slider button in the extension, you'll see a bar that includes a dropdown and various buttons to the right. This is the slider collections system, think of this like presets but for your sliders. It lets you hotswap between sliders!

<img width="542" height="91" alt="image" src="https://github.com/user-attachments/assets/9d0e6146-1b39-4e84-accc-06606161b8cd" />

You have the following options here:

- The dropdown can be used to select a collection, these auto-save whenever you change the sliders below
- The folder/plus button to the right of it creates a new collection.
- The import (arrow in) and export (arrow out) buttons allow you to import and export slider collections.
- Lastly, the trash can icon lets you delete a collection (no way to undo this, be careful!).

## Power User Features

The below features allow you to hook into and overwrite any local or global variable (getvar retrieved variables), or even any Sillytavern Macro. Use these features with caution! They are easily reversible by just changing the slider macro to another value and refreshing sillytavern, but I still recommend you don't use them unless you know what you're doing!

### The Sync to Variables System

Near the bottom of the configuring Sliders page is a box that allows you to sync the value of the slider to overwrite any variable of your choice. You can use the dropdown to select local or global variables and the status message underneath will let you know if there is a variable matching the name. You'll need the variable to already exist via {{setvar::variableName::value}}. Do a {{getvar::variablename}} first to initialize the variable in memory. Then you can use the slider to overwrite the value of the variable and see it reflected in further getvar calls.

<img width="453" height="143" alt="image" src="https://github.com/user-attachments/assets/9cb3a66d-f631-464f-97ff-4a250a1aa3ec" />

You can see me initialize and call a variable here so it'll be in memory.


<img width="700" height="176" alt="image" src="https://github.com/user-attachments/assets/b315cb32-d13f-4107-b78a-32d84a3800b8" />

Now if I enter this variable into the box it is synced and if I change the associated slider value it will overwrite the variable!

Simply change the synced variable name or untick the box and reload sillytavern or setvar to whatever you want to undo this.

> [!NOTE]
> The search button to the right of the variable name is current non-functional, but will be implemented in the future!

### The Sync to Macros System (For Power Users only!)

If you set the macroname to an existing sillytavern macro, you can overwrite/hijack it's output using the slider! There is even a search button next to macro name to help you find existing macros. It has no safeguards, so be careful! We are not responsible for you turning {{Trim}} to be zalgo text and then causing your entire preset to temporarily be spooky! Basically the search box allows you to search for a {{macroName}} and then set it to the value of the slider.

<img width="467" height="177" alt="image" src="https://github.com/user-attachments/assets/8e2bf89b-2147-499c-906d-78f0fcc37a28" />

Above the search bar can be seen to the right of the macro button.

<img width="481" height="498" alt="image" src="https://github.com/user-attachments/assets/6ba72ca7-aae4-4240-b039-ce4ff0e46779" />

In the search I can set it to {{maxprompt}} which normally retrieves the max context.

<img width="459" height="113" alt="image" src="https://github.com/user-attachments/assets/ab965b60-c3ff-4202-acd4-d0ea08422014" />

You can see selecting a macro from the search results populates the macro name with said macro.

<img width="367" height="160" alt="image" src="https://github.com/user-attachments/assets/15437304-d2fb-4d21-8984-57a08d1f28f6" />

Now I move the slider to 42, and when I call max prompt, you can see it shows the slider value.

<img width="303" height="143" alt="image" src="https://github.com/user-attachments/assets/963c0354-39ba-49e6-b7c6-a17655af9718" />

> [!NOTE]
> If you ever get in a sticky situation, just change the macro to a different non-occupied value and reload the SillyTavern page to reset the macro to the original SillyTavern value!

### Troubleshooting

If any {{Macros}} aren't working for you, make sure you enabled the experimental macro engine!!

## License

AGPL-3.0
