import os

favicon_path = r"c:\Users\visha\hookrelay\frontend\public\favicon.png"

if os.path.exists(favicon_path):
    os.remove(favicon_path)
    print(f"Removed redundant file: {favicon_path}")
else:
    print("File already removed.")
