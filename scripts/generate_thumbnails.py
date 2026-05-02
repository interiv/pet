import os
from PIL import Image

IMAGES_ROOT = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', 'images')
THUMB_SUFFIX = '_thumb'
THUMB_SIZE = (200, 200)
TARGET_DIRS = ['pets', 'items', 'equipment']


def generate_thumbnails_for_dir(dir_path, dir_label):
    total_original = 0
    total_thumb = 0
    count = 0

    for root, dirs, files in os.walk(dir_path):
        for fname in files:
            if not fname.lower().endswith('.png'):
                continue
            if THUMB_SUFFIX in fname:
                continue

            filepath = os.path.join(root, fname)
            name_no_ext = os.path.splitext(fname)[0]
            thumb_fname = f"{name_no_ext}{THUMB_SUFFIX}.png"
            thumb_path = os.path.join(root, thumb_fname)

            if os.path.exists(thumb_path):
                original_size = os.path.getsize(filepath)
                thumb_size = os.path.getsize(thumb_path)
                total_original += original_size
                total_thumb += thumb_size
                continue

            try:
                img = Image.open(filepath)
                original_size = os.path.getsize(filepath)

                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGBA')
                    bg = Image.new('RGBA', img.size, (0, 0, 0, 0))
                    bg.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                    img = bg

                img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                img.save(thumb_path, 'PNG', optimize=True)

                thumb_size = os.path.getsize(thumb_path)
                total_original += original_size
                total_thumb += thumb_size
                count += 1

                ratio = (1 - thumb_size / original_size) * 100
                rel = os.path.relpath(thumb_path, dir_path)
                print(f"  {rel}: {original_size/1024:.0f}KB -> {thumb_size/1024:.0f}KB (-{ratio:.0f}%)")

            except Exception as e:
                print(f"  ERROR {filepath}: {e}")

    print(f"\n=== {dir_label} ===")
    print(f"  Generated: {count} new thumbnails")
    print(f"  Original total: {total_original/1024/1024:.1f} MB")
    print(f"  Thumbnail total: {total_thumb/1024/1024:.1f} MB")
    if total_original > 0:
        print(f"  Saved: {(total_original - total_thumb)/1024/1024:.1f} MB ({(1 - total_thumb/total_original)*100:.0f}%)")
    return total_original, total_thumb


def main():
    grand_original = 0
    grand_thumb = 0

    for d in TARGET_DIRS:
        dir_path = os.path.join(IMAGES_ROOT, d)
        if not os.path.isdir(dir_path):
            print(f"Skip {d}: directory not found")
            continue
        print(f"\n>>> Processing: {d}/")
        o, t = generate_thumbnails_for_dir(dir_path, d)
        grand_original += o
        grand_thumb += t

    print(f"\n{'='*40}")
    print(f"TOTAL across all directories:")
    print(f"  Original: {grand_original/1024/1024:.1f} MB")
    print(f"  Thumbnails: {grand_thumb/1024/1024:.1f} MB")
    if grand_original > 0:
        print(f"  Saved: {(grand_original - grand_thumb)/1024/1024:.1f} MB ({(1 - grand_thumb/grand_original)*100:.0f}%)")


if __name__ == '__main__':
    main()
