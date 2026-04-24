from PIL import Image

def make_transparent(image_path, output_path):
    print("Opening logo...")
    img = Image.open(image_path)
    img = img.convert("RGBA")
    
    datas = img.getdata()
    newData = []
    
    # Tolerance for "white"
    threshold = 240
    
    for item in datas:
        # If the pixel is mostly white, make it transparent
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
            
    img.putdata(newData)
    print(f"Saving transparent logo to {output_path}...")
    img.save(output_path, "PNG")
    print("Done!")

# Process the logo that's already in the folder
make_transparent(
    r"c:\Users\visha\hookrelay\hookrelay-logo.png",
    r"c:\Users\visha\hookrelay\hookrelay-logo.png"
)
