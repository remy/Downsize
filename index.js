var XRegexp = require('xregexp').XRegExp;

(function (exportTo) {
    "use strict";

    // Nodes which should be considered implicitly self-closing
    // Taken from http://www.whatwg.org/specs/web-apps/current-work/multipage/syntax.html#void-elements
    var voidElements = [
        "area", "base", "br", "col", "command", "embed", "hr", "img", "input",
        "keygen", "link", "meta", "param", "source", "track", "wbr"
    ];

    var downsize = function (text, inputOptions, offset) {
        var stack = [],
            pointer = 0,
            tagName = "",
            parseState = 0,
            trackedState = {},
            tagBuffer = "",
            truncatedText = "";

        var COUNT_CHARACTERS = -1,
            COUNT_WORDS = -2;

        var options = inputOptions && typeof inputOptions === "object" ? inputOptions : {},
            wordChars = options.wordChars instanceof RegExp ?
                options.wordChars : new XRegexp("[\\p{L}0-9\\-\\']", "i");
        options.countingType = !isNaN(Number(options.words)) ? COUNT_WORDS : COUNT_CHARACTERS;

        var keepContext = !!options.contextualTags,
            contextualTags = (
                keepContext && Array.isArray(options.contextualTags) ?
                    options.contextualTags : []
            );

        var limit = (options.countingType === COUNT_WORDS) ? Number(options.words) :
            Number(options.characters) + 1;

        function count(chr) {
            var stackIndex = 0;

            if (!("unitCount" in trackedState)) {
                trackedState.unitCount = 0;
            }

            // Tick-tock state storage for counting words
            // If it doesn't exist, initialise it with value of current char
            if (!("countState" in trackedState)) {
                trackedState.countState = !!wordChars.test(chr + "");
            }

            switch (options.countingType) {
                case COUNT_WORDS:
                    if (!!wordChars.test(chr + "") !== trackedState.countState) {

                        trackedState.countState = !!wordChars.test(chr + "");

                        // Only count the words on the "tock", or we'd be counting
                        // them twice.
                        if (!trackedState.countState) {
                            trackedState.unitCount++;
                        }
                    }
                    break;

                case COUNT_CHARACTERS:
                    // We pass in empty values to count word boundries
                    // defined by tags.
                    // This isn't relevant to character truncation.
                    if (chr !== "") {
                        trackedState.unitCount++;
                    }
                    break;
            }

            // Return true when we've hit our limit
            if (trackedState.unitCount < limit) {
                return false;
            }

            // If we've got no special context to retain, do an early return.
            if (!keepContext) {
                return true;
            }
            
            for (; stackIndex < stack.length; stackIndex++) {
                if (~contextualTags.indexOf(getTagName(stack[stackIndex]))) {
                    return false;
                }
            }

            // There are no contextual tags left, we can stop.
            return true;
        }

        // Define our parse states
        var PARSER_UNINITIALISED = 0,
            PARSER_TAG_COMMENCED = 1,
            PARSER_TAG_STRING = -1,
            PARSER_TAG_STRING_SINGLE = -2,
            PARSER_COMMENT = -3;

        for (; pointer < text.length; pointer++) {

            if (parseState !== PARSER_UNINITIALISED) {
                tagBuffer += text[pointer];
            }

            switch (text[pointer]) {

                case "<":
                    // Ooh look — we're starting a new tag.
                    // (Provided we're in uninitialised state and the next
                    // character is a word character, explamation mark or slash)
                    if (parseState === PARSER_UNINITIALISED &&
                        text[pointer + 1].match(/[a-z0-9\-\_\/\!]/)) {

                        parseState = PARSER_TAG_COMMENCED;
                        tagBuffer += text[pointer];
                    }

                    break;

                case "!":
                    if (parseState === PARSER_TAG_COMMENCED &&
                        text[pointer - 1] === "<") {

                        parseState = PARSER_COMMENT;
                    }

                    break;

                case "-":
                    if (parseState === PARSER_COMMENT)
                        parseState = PARSER_COMMENT;

                    break;

                case "\"":
                    if (parseState === PARSER_TAG_STRING) {
                        parseState = PARSER_TAG_COMMENCED;

                    } else if (parseState === PARSER_TAG_STRING_SINGLE) {
                        // if double quote is found in a single quote string,
                        // ignore it and let the string finish
                        break;

                    } else if (parseState !== PARSER_UNINITIALISED) {
                        parseState = PARSER_TAG_STRING;
                    }

                    break;

                case "'":
                    if (parseState === PARSER_TAG_STRING_SINGLE) {
                        parseState = PARSER_TAG_COMMENCED;

                    } else if (parseState === PARSER_TAG_STRING) {
                        // if single quote is found in a double quote string,
                        // ignore it and let the string finish
                        break;

                    } else if (parseState !== PARSER_UNINITIALISED) {
                        parseState = PARSER_TAG_STRING_SINGLE;
                    }

                    break;

                case ">":

                    if (parseState === PARSER_TAG_COMMENCED) {

                        parseState = PARSER_UNINITIALISED;
                        truncatedText += tagBuffer;
                        tagName = getTagName(tagBuffer);

                        // Closing tag. (Do we need to be more lenient/)
                        if (tagBuffer.match(/<\s*\//)) {

                            // We don't attempt to walk up the stack to close
                            // tags. If the text to be truncated contains
                            // malformed nesting, we just close what we're
                            // permitted to and clean up at the end.
                            if (getTagName(stack[stack.length-1]) === tagName) {
                                stack.pop();
                            }

                            // Nope, it's an opening tag.
                        } else {

                            // Don't push self closing or void elements on to
                            // the stack, since they have no effect on nesting.

                            if (voidElements.indexOf(tagName) < 0 &&
                                !tagBuffer.match(/\/\s*>$/)) {

                                stack.push(tagBuffer);
                            }
                        }

                        tagBuffer = "";

                        // Closed tags are word boundries. Count!
                        // Because we've reset our parser state we need
                        // to manually short circuit the logic that comes next.
                        if (!count("")) {
                            continue;
                        }
                    }

                    if (parseState === PARSER_COMMENT &&
                        text.substring(pointer - 2, pointer) === "--") {

                        parseState = PARSER_UNINITIALISED;
                        truncatedText += tagBuffer;
                        tagBuffer = "";

                        // Closed tags are word boundries. Count!
                        if (!count("")) {
                            continue;
                        }
                    }

                    break;
            }

            // We're not inside a tag, comment, attribute, or string.
            // This is just text.
            if (!parseState) {

                // Have we had enough of a good thing?
                if (count(text[pointer])) {
                    break;
                }

                // Nope, we still thirst for more.
                truncatedText += text[pointer];
            }
        }

        if (options.append && (stack.length || tagBuffer.length)) {
            truncatedText = truncatedText.trim() + options.append;
        }

        // Append anything still left in the buffer
        truncatedText += tagBuffer;

        // Balance anything still left on the stack
        while (stack.length) {
            truncatedText += closeTag(stack.pop());
        }

        return truncatedText;
    };

    function closeTag(openingTag) {
        // Grab the tag name, including namespace, if there is one.
        var tagName = getTagName(openingTag);

        // We didn't get a tag name, so return nothing. Better than
        // a bad prediction, or a junk tag.
        if (!tagName) {
            return "";
        }

        return "</" + tagName + ">";
    }

    function getTagName(tag) {
        var tagName = (tag || "").match(/<\/*([a-z0-9\:\-\_]+)/i);
        return tagName ? tagName[1] : null;
    }

    // Export to node
    if (typeof module !== 'undefined' && module.exports) {
        return module.exports = downsize;
    }

    // Nope, export to the browser instead.
    exportTo.downsize = downsize;
}(this));
