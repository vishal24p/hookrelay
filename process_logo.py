from PIL import Image, ImageChops
import shutil
import os

source_path = r"C:\Users\visha\.gemini\antigravity\brain\175906a5-d5b9-4c7d-8356-9ce4fbbdf390\hookrelay_logo_v1_1777028814292.png"

def trim(im):
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        # Add a tiny bit of padding (e.g., 20 pixels)
        padding = 20
        return im.crop((
            max(0, bbox[0] - padding),
            max(0, bbox[1] - padding),
            min(im.size[0], bbox[2] + padding),
            min(im.size[1], bbox[3] + padding)
        ))
    return im

print("Opening image...")
img = Image.open(source_path)

print("Cropping whitespace...")
cropped_img = trim(img)

dest_path = r"c:\Users\visha\hookrelay\hookrelay-logo.png"
cropped_img.save(dest_path)
print(f"Saved cropped logo to {dest_path}")
