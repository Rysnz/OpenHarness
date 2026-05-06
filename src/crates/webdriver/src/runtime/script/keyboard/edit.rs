pub(super) fn script() -> &'static str {
    r####"
    const selectionBounds = (target, fallbackLength) => ({
      start: typeof target.selectionStart === "number" ? target.selectionStart : fallbackLength,
      end: typeof target.selectionEnd === "number" ? target.selectionEnd : fallbackLength,
    });

    const replaceTextRange = (target, value, start, end, replacement = "") => {
      setElementValue(target, value.slice(0, start) + replacement + value.slice(end));
    };

    const removeBackward = (target, value, start, end) => {
      if (start !== end) {
        replaceTextRange(target, value, start, end);
        setSelectionRange(target, start, start);
        return;
      }

      if (start === 0) {
        return;
      }

      replaceTextRange(target, value, start - 1, end);
      setSelectionRange(target, start - 1, start - 1);
    };

    const removeForward = (target, value, start, end) => {
      const deleteEnd = start === end ? start + 1 : end;
      replaceTextRange(target, value, start, deleteEnd);
      setSelectionRange(target, start, start);
    };

    const deleteEditableContent = (target, direction) => {
      const value = String(getElementValue(target) || "");
      const { start, end } = selectionBounds(target, value.length);
      const inputType = direction === "backward" ? "deleteContentBackward" : "deleteContentForward";

      if (!dispatchBeforeInputEvent(target, inputType, null)) {
        return;
      }

      if (direction === "backward") {
        removeBackward(target, value, start, end);
      } else {
        removeForward(target, value, start, end);
      }

      emitInputEvents(target, inputType, null);
    };

    const moveEditableCaret = (target, key) => {
      const caretMoves = {
        ArrowLeft: "left",
        ArrowRight: "right",
        Home: "start",
        End: "end",
      };
      const direction = caretMoves[key];
      if (direction) {
        moveCaret(target, direction);
        return true;
      }
      return false;
    };

    const applySpecialKey = (target, key, modifiers, frameContext = currentFrameContext) => {
      if (!target) {
        return;
      }

      const isInputLike = "value" in target;
      if ((modifiers.ctrl || modifiers.meta) && key.toLowerCase() === "a" && isInputLike) {
        const value = String(target.value || "");
        setSelectionRange(target, 0, value.length);
        return;
      }

      if (key === "Tab") {
        moveFocusByTab(target, modifiers.shift, frameContext);
        return;
      }

      if (key === "Backspace" && isInputLike) {
        deleteEditableContent(target, "backward");
        return;
      }

      if (key === "Delete" && isInputLike) {
        deleteEditableContent(target, "forward");
        return;
      }

      if (isInputLike && moveEditableCaret(target, key)) {
        return;
      }

      if (key === "Enter") {
        if (isInputLike && String(target.tagName || "").toUpperCase() === "TEXTAREA" && !modifiers.ctrl && !modifiers.meta) {
          insertText(target, "\n");
        }
        return;
      }

      if (key.length === 1 && !modifiers.ctrl && !modifiers.meta && !modifiers.alt) {
        insertText(target, getPrintableKey(key, modifiers));
      }
    };
"####
}
