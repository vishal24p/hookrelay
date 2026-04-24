import shutil
import os

source_path = r"C:\Users\visha\.gemini\antigravity\brain\175906a5-d5b9-4c7d-8356-9ce4fbbdf390\hookrelay_logo_final_1777029415628.png"

# Copy for README
shutil.copy2(source_path, r"c:\Users\visha\hookrelay\hookrelay-logo.png")

# Copy for Frontend (public folder for Vite)
public_dir = r"c:\Users\visha\hookrelay\frontend\public"
os.makedirs(public_dir, exist_ok=True)
shutil.copy2(source_path, os.path.join(public_dir, "logo.png"))
shutil.copy2(source_path, os.path.join(public_dir, "favicon.png")) # Also for favicon

print("Images copied successfully")
