# C++ Notebook (cppnb)

Run **C++ code in a notebook environment**—like Jupyter, but for C++—directly inside Visual Studio Code. This extension enables incremental development across cells, state caching, configurable compilation settings, and clean inline output.

---

## Features

- **Notebook-style Cell Execution**
  - Run individual code cells in isolation
  - State cells (no `main()`) persist and compile once for reuse
- **State Caching**
  - Functions, classes, and variables remain available across cells
- **Input Handling**
  - Detects `cin`, `getline`, etc. and prompts for input when needed
  - Manual input mode via command palette
- **Formatted Output**
  - Optional pretty output cards (`cppnb.prettyUI`)
- **Configurable Compiler & Flags**
  - Supports MinGW, MSYS2, GCC, Clang, and WSL
- **Timeout Protection**
  - Prevents infinite loops from hanging VS Code

---

## Requirements

### Windows (MinGW Recommended)

1. Install [MinGW-w64](https://www.mingw-w64.org/downloads/).
2. Verify your compiler installation:

where g++

The typical installation path:

`C:\MinGW\bin\g++.exe`


3. Ensure this path is added to your **System Environment PATH**.

---

## Creating a Notebook

1. Press **Ctrl + Shift + P**
2. Select **C++ Notebook: New Notebook**
3. Save with extension:

<filename>.cppnb

---

## Cell Types

### 1. State Cell

A cell **without `main()`**—compiled into a reusable object file.

`int add(int a, int b) {
return a + b;
}`

### 2. Run Cell

A cell **with `main()`**—linked with prior compiled state and executed.

`#include <iostream>
using namespace std;
int main() {
cout << add(5, 7) << endl;
}`

---

## Input Handling

### Automatic (Default)

If your program uses `cin`, `getline`, or `scanf`, you will be prompted for input.

### Manual

Use the command palette:

C++ Notebook: Run Cell With Input

Input format example:


---

## Settings

| Setting              | Default                   | Description                                      |
|----------------------|---------------------------|--------------------------------------------------|
| `cppnb.compilerPath` | `C:\MinGW\bin\g++.exe`    | Path to your g++ compiler                        |
| `cppnb.std`          | `c++17`                   | C++ standard for cells                           |
| `cppnb.timeoutMs`    | `5000`                    | Execution timeout per cell (ms)                  |
| `cppnb.extraArgs`    | `[]`                      | Extra arguments for g++                          |
| `cppnb.askForInput`  | `auto`                    | When to prompt for input (`auto`, `always`, `never`) |
| `cppnb.prettyUI`     | `true`                    | Show formatted output blocks                     |

---

## Commands

| Command                           | Description                                |
|------------------------------------|--------------------------------------------|
| **C++ Notebook: New Notebook**     | Create a new `.cppnb` file                 |
| **C++ Notebook: Clear Shared State** | Remove cached compiled objects              |
| **C++ Notebook: Run Cell With Input** | Run current cell and provide custom input   |

---

## Known Limitations

- Interactive or real-time terminal programs are not supported
- Infinite loops are terminated after the timeout period

---

## License

MIT License © 06Neel