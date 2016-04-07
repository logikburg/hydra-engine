hydro 
=========

## Requirement:
     Node.js >= v4 
     Mongodb >= 3.2 should be installed.

## Note: No npm install is required. 
1. The stories and sitemaps collections should be on MongoDB instance. 
2. This repo has already the required node modules, so no npm install is required.

For your local development:
```
sudo mongod --dbpath=/data --port 27017 --fork --logpath /var/log/mongod.log
```

To Run the app
```
sudo node hydro.js
```