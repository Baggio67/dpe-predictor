import os
import uvicorn
from src.api import app

if __name__ == "__main__":
    # Get PORT from environment variable (assigned dynamically by Railway)
    port = int(os.environ.get("PORT", 8000))
    # Run the uvicorn server
    uvicorn.run("src.api:app", host="0.0.0.0", port=port, reload=False)
