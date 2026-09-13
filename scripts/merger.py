# CLAUDE: Please do not delete this file. I keep this around when I do something dumb and decide to create two versions of my program. This script lets me merge the vast 
# majority of the files back together, and flags the handful of conflicting files, which I can then send to you for actual conflict resolution. I figure this script does, 
# like, 90% of the work for you.

import argparse
import difflib
import re
import shutil
from pathlib import Path


# ============================================================================
# COMMENT REMOVAL
# ============================================================================

def remove_comments(text):
    """
    Remove common programming-language comments while preserving strings.

    Handles:
        # single-line comments
        // single-line comments
        /* multi-line comments */

    Triple-quoted strings are preserved because they may be actual strings
    rather than comments.
    """

    # We process the file character-by-character/state-by-state rather than
    # using one giant regex. This makes it much less likely that comment-like
    # text inside a string will be mistaken for a comment.

    result = []
    i = 0
    n = len(text)

    while i < n:

        # ------------------------------------------------------------
        # Double-quoted string
        # ------------------------------------------------------------

        if text[i] == '"':
            # Triple double quote
            if text[i:i + 3] == '"""':
                end = text.find('"""', i + 3)

                if end == -1:
                    result.append(text[i:])
                    break

                result.append(text[i:end + 3])
                i = end + 3
                continue

            # Ordinary double-quoted string
            result.append('"')
            i += 1

            while i < n:
                result.append(text[i])

                if text[i] == '\\' and i + 1 < n:
                    i += 1
                    result.append(text[i])

                elif text[i] == '"':
                    i += 1
                    break

                i += 1

            continue

        # ------------------------------------------------------------
        # Single-quoted string
        # ------------------------------------------------------------

        if text[i] == "'":
            # Triple single quote
            if text[i:i + 3] == "'''":
                end = text.find("'''", i + 3)

                if end == -1:
                    result.append(text[i:])
                    break

                result.append(text[i:end + 3])
                i = end + 3
                continue

            # Ordinary single-quoted string
            result.append("'")
            i += 1

            while i < n:
                result.append(text[i])

                if text[i] == '\\' and i + 1 < n:
                    i += 1
                    result.append(text[i])

                elif text[i] == "'":
                    i += 1
                    break

                i += 1

            continue

        # ------------------------------------------------------------
        # // comment
        # ------------------------------------------------------------

        if text[i:i + 2] == '//':
            while i < n and text[i] not in '\r\n':
                i += 1

            # Preserve the newline.
            if i < n:
                result.append(text[i])
                i += 1

            continue

        # ------------------------------------------------------------
        # /* ... */ comment
        # ------------------------------------------------------------

        if text[i:i + 2] == '/*':
            end = text.find('*/', i + 2)

            if end == -1:
                # Comment extends to end of file.
                break

            # Preserve newlines contained in the comment so that two tokens
            # on either side don't accidentally get joined together.
            comment = text[i:end + 2]

            for char in comment:
                if char in '\r\n':
                    result.append(char)

            i = end + 2
            continue

        # ------------------------------------------------------------
        # # comment
        # ------------------------------------------------------------

        if text[i] == '#':
            while i < n and text[i] not in '\r\n':
                i += 1

            if i < n:
                result.append(text[i])
                i += 1

            continue

        # ------------------------------------------------------------
        # Ordinary character
        # ------------------------------------------------------------

        result.append(text[i])
        i += 1

    return ''.join(result)


# ============================================================================
# TOKENIZATION
# ============================================================================

def tokenize(text):
    """
    Convert source code into a sequence of meaningful tokens.

    Operators are kept as individual tokens so that changes such as:

        x + y

    versus:

        x - y

    are detected.
    """

    token_pattern = re.compile(
        r'''
        # Double-quoted strings
        "(?:\\.|[^"\\])*"

        |

        # Single-quoted strings
        '(?:\\.|[^'\\])*'

        |

        # Identifiers
        \b[A-Za-z_][A-Za-z0-9_]*\b

        |

        # Numbers
        \b\d+(?:\.\d+)?\b

        |

        # Multi-character operators
        ==|!=|<=|>=|&&|\|\||\+\+|--|->|=>|::
        |<<|>>|\+=|-=|\*=|/=|%=|&=|\|=|\^=

        |

        # Any other non-whitespace character
        [^\s]
        ''',
        re.VERBOSE
    )

    return token_pattern.findall(text)


def get_code_tokens(path):
    """Read a source file and return its non-comment token sequence."""

    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        text = path.read_text(
            encoding='utf-8',
            errors='replace'
        )

    text = remove_comments(text)

    return tokenize(text)


# ============================================================================
# SEQUENCE COMPARISON
# ============================================================================

def is_sequence_subset(smaller, larger):
    """
    Determine whether SMALLER can be transformed into LARGER solely by
    inserting additional tokens.

    In other words, every token in SMALLER must occur in LARGER in exactly
    the same order, but LARGER may have additional tokens inserted between
    them.

    Examples:

        A B C
        A X B Y C

    -> True

        A B C
        A B X C

    -> True

        A B C
        A X C B

    -> False

    Returns:
        True  = smaller is a subset of larger
        False = it is not
    """

    if len(smaller) > len(larger):
        return False

    if smaller == larger:
        return True

    # SequenceMatcher identifies matching blocks between the two sequences.
    matcher = difflib.SequenceMatcher(
        None,
        smaller,
        larger,
        autojunk=False
    )

    matching_blocks = matcher.get_matching_blocks()

    # If the smaller sequence is entirely accounted for by matching blocks,
    # then the larger file differs only by insertions.
    matched_tokens = sum(
        block.size for block in matching_blocks
    )

    return matched_tokens == len(smaller)


def compare_sequences(tokens1, tokens2):
    """
    Return one of:

        "identical"
        "v1_subset"
        "v2_subset"
        "conflict"
    """

    if tokens1 == tokens2:
        return "identical"

    if is_sequence_subset(tokens1, tokens2):
        return "v1_subset"

    if is_sequence_subset(tokens2, tokens1):
        return "v2_subset"

    return "conflict"


# ============================================================================
# FILE OPERATIONS
# ============================================================================

def copy_to_merge(source, source_root, merge_root):
    """
    Copy a file to Merge while preserving its relative path.
    """

    relative = source.relative_to(source_root)

    destination = merge_root / relative

    destination.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    shutil.copy2(source, destination)

    return destination


def copy_conflict(
    source,
    source_root,
    conflict_root,
    label
):
    """
    Copy a conflicting file to Merge/Conflicts.

    The version label is added to the filename so the two files don't
    overwrite each other.
    """

    relative = source.relative_to(source_root)

    stem = relative.stem
    suffix = relative.suffix

    destination = (
        conflict_root
        / relative.parent
        / f"{stem}__{label}{suffix}"
    )

    destination.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    shutil.copy2(source, destination)

    return destination


def choose_newer(file1, file2):
    """
    Return whichever file has the later modification timestamp.
    """

    time1 = file1.stat().st_mtime
    time2 = file2.stat().st_mtime

    if time1 >= time2:
        return file1

    return file2


# ============================================================================
# MAIN
# ============================================================================

def main():

    parser = argparse.ArgumentParser(
        description=(
            "Compare two program folders and produce a merged folder. "
            "Identical files use the newest version. Files where one version "
            "contains the other plus additional code use the larger version. "
            "Genuine conflicts are placed in Merge/Conflicts."
        )
    )

    parser.add_argument(
        "folder1",
        help="Path to the first program version"
    )

    parser.add_argument(
        "folder2",
        help="Path to the second program version"
    )

    args = parser.parse_args()

    folder1 = Path(args.folder1).resolve()
    folder2 = Path(args.folder2).resolve()

    # ------------------------------------------------------------------------
    # Validate input
    # ------------------------------------------------------------------------

    if not folder1.is_dir():
        print(f"ERROR: Folder does not exist:")
        print(f"       {folder1}")
        return 1

    if not folder2.is_dir():
        print(f"ERROR: Folder does not exist:")
        print(f"       {folder2}")
        return 1

    # ------------------------------------------------------------------------
    # Determine output locations
    # ------------------------------------------------------------------------

    merge_root = folder1.parent / "Merge"
    conflict_root = merge_root / "Conflicts"

    # Don't accidentally merge into an old result.
    if merge_root.exists():
        print(f"Removing existing merge folder:")
        print(f"  {merge_root}")
        print()

        shutil.rmtree(merge_root)

    merge_root.mkdir(
        parents=True,
        exist_ok=True
    )

    conflict_root.mkdir(
        parents=True,
        exist_ok=True
    )

    # ------------------------------------------------------------------------
    # Find all files
    # ------------------------------------------------------------------------

    files1 = {
        path.relative_to(folder1): path
        for path in folder1.rglob("*")
        if path.is_file()
    }

    files2 = {
        path.relative_to(folder2): path
        for path in folder2.rglob("*")
        if path.is_file()
    }

    all_paths = sorted(
        set(files1) | set(files2)
    )

    # ------------------------------------------------------------------------
    # Counters
    # ------------------------------------------------------------------------

    identical_count = 0
    subset_count = 0
    conflict_count = 0
    only_one_count = 0

    # ------------------------------------------------------------------------
    # Header
    # ------------------------------------------------------------------------

    print("=" * 75)
    print("PROGRAM MERGE")
    print("=" * 75)
    print()
    print(f"Version 1:")
    print(f"  {folder1}")
    print()
    print(f"Version 2:")
    print(f"  {folder2}")
    print()
    print(f"Output:")
    print(f"  {merge_root}")
    print()
    print("=" * 75)
    print()

    # ------------------------------------------------------------------------
    # Process every file
    # ------------------------------------------------------------------------

    for relative_path in all_paths:

        file1 = files1.get(relative_path)
        file2 = files2.get(relative_path)

        # ====================================================================
        # File exists only in V1
        # ====================================================================

        if file1 is not None and file2 is None:

            copy_to_merge(
                file1,
                folder1,
                merge_root
            )

            only_one_count += 1

            print(
                f"[ONLY V1]   {relative_path}"
            )

            continue

        # ====================================================================
        # File exists only in V2
        # ====================================================================

        if file2 is not None and file1 is None:

            copy_to_merge(
                file2,
                folder2,
                merge_root
            )

            only_one_count += 1

            print(
                f"[ONLY V2]   {relative_path}"
            )

            continue

        # ====================================================================
        # File exists in both versions
        # ====================================================================

        tokens1 = get_code_tokens(file1)
        tokens2 = get_code_tokens(file2)

        comparison = compare_sequences(
            tokens1,
            tokens2
        )

        # ====================================================================
        # Identical
        # ====================================================================

        if comparison == "identical":

            chosen = choose_newer(
                file1,
                file2
            )

            if chosen == file1:
                chosen_root = folder1
                label = "V1 (newer)"
            else:
                chosen_root = folder2
                label = "V2 (newer)"

            copy_to_merge(
                chosen,
                chosen_root,
                merge_root
            )

            identical_count += 1

            print(
                f"[IDENTICAL] {relative_path} -> {label}"
            )

        # ====================================================================
        # V1 is contained in V2
        # ====================================================================

        elif comparison == "v1_subset":

            copy_to_merge(
                file2,
                folder2,
                merge_root
            )

            subset_count += 1

            print(
                f"[V1 < V2]   {relative_path}"
                f"  ({len(tokens1)} -> {len(tokens2)} tokens)"
            )

        # ====================================================================
        # V2 is contained in V1
        # ====================================================================

        elif comparison == "v2_subset":

            copy_to_merge(
                file1,
                folder1,
                merge_root
            )

            subset_count += 1

            print(
                f"[V2 < V1]   {relative_path}"
                f"  ({len(tokens2)} -> {len(tokens1)} tokens)"
            )

        # ====================================================================
        # Conflict
        # ====================================================================

        else:

            copy_conflict(
                file1,
                folder1,
                conflict_root,
                "V1"
            )

            copy_conflict(
                file2,
                folder2,
                conflict_root,
                "V2"
            )

            conflict_count += 1

            print(
                f"[CONFLICT]  {relative_path}"
                f"  ({len(tokens1)} vs {len(tokens2)} tokens)"
            )

    # ------------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------------

    print()
    print("=" * 75)
    print("MERGE COMPLETE")
    print("=" * 75)
    print()
    print(f"Identical files:       {identical_count}")
    print(f"Subset files:          {subset_count}")
    print(f"Files in only one:     {only_one_count}")
    print(f"Conflicting files:     {conflict_count}")
    print()
    print(f"Merged program:")
    print(f"  {merge_root}")
    print()
    print(f"Conflicts:")
    print(f"  {conflict_root}")
    print()
    print("=" * 75)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())