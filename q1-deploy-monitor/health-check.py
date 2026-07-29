from urllib.request import urlopen
from urllib.error import HTTPError
import time


while True:
    try:
     with urlopen('https://my-application-2f85feb054d8.hosted.ghaymah.systems/health') as response:
        print(f"Status Code: {response.status}")

    except HTTPError as error:
     print(f"Error Status Code: {error.code}")
    time.sleep(30) 
