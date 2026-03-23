# Jira Component Autofill

A Chrome extension that automatically fills the **Component** field when creating Jira tasks and subtasks.

## Problem

When creating tasks in Jira, the Component field must be filled manually every time. For teams that always use the same component per project, this is repetitive and error-prone — especially for subtasks where the Space field is locked and inherited from the parent.

## Solution

The extension detects when a Create Task or Create Subtask dialog opens and automatically selects the configured component based on the project/space. It works with both the standard task form and the subtask form (where the Space field is read-only).

## Features

- **Auto-fill on open** — component is selected automatically when the create dialog appears, no clicks needed
- **Subtask support** — works even when the Space field is locked/inherited from the parent issue
- **Rule-based configuration** — define rules per project key (e.g. `ENG` → `user customization`)
- **Multiple rules** — configure different components for different projects
- **Enable/disable** — toggle the extension on/off without removing rules
- **Apply Now button** — manually trigger autofill from the popup
- **Debug log** — built-in ring-buffer log (60 entries) with Show/Copy buttons in the popup for troubleshooting

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extension folder
5. The extension icon will appear in the toolbar

## Configuration

1. Click the extension icon → **Open rules**
2. Click **Add rule**:
   - **Project matcher** — part of the project key (e.g. `ENG`)
   - **Components** — comma-separated component names (e.g. `user customization`)
3. Save the rule

The matcher is checked against the project key in the URL and the Space/Project field value in the form.

## How It Works

- A `MutationObserver` watches for create dialogs appearing in the DOM
- When a dialog is detected, the extension reads the project context and finds a matching rule
- The component field input is focused, the component name is typed, and the matching option is clicked from the dropdown
- After selection, the container is marked as processed to prevent duplicate fills
- Outbound `fetch` and `XHR` calls to `/rest/api/3/issue` are also intercepted to inject the component into the request payload as a safety net

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save rules and settings |
| `activeTab` | Interact with the current Jira tab |
| `tabs` | Send messages to the content script |
| `scripting` | Re-inject content scripts after extension updates without requiring a page reload |
| `https://*.atlassian.net/*` | Run on Jira Cloud pages |

## Notes

- Does not require Jira admin rights
- Works with Jira Cloud company-managed projects
- Tested on `*.atlassian.net` (Creatio Jira)
