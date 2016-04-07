/*
 * @author Sandeep Mogla
*/
var async = require('async');
var request = require('request');
var FeedParser = require('feedparser'); 
var Iconv = require('iconv').Iconv;   //Text recoding/encoding; encode from one character encoding to another
var striptags = require('striptags');   //Allow to remove HTML Markups from RRS feed's properties
var zlib = require('zlib');
var getSummary = require('summarizer').getPage;
var mongoose = require('mongoose');
var mlspotlight = require('dbpedia-spotlight');
var langdetect = require('langdetect');
var numberOfSitemaps = 0;
var opts = {
    replset: {
        readPreference: 'ReadPreference.nearest'
    }
};
var feedCount = -1;

//Connecto to MongoDB

// LOCALHOST MODE
var storiesDB = mongoose.createConnection('mongodb://localhost:27017/stories', opts);
var sitemapsDB = mongoose.createConnection('mongodb://localhost:27017/sitemaps', opts);

var PostSchema = new mongoose.Schema({
    title:String,
    author :String,
    description :String,
    image :String,
    pubDate :String,
    summary :String,
    url :String,
    words: String,
    minutes: String,
    sentiment: String,
    difficulty: String,
    topics : { type: Array, index: true },
    analysis: String,
    when : { type: Number, index: true },
    source :String,
    language :String
});
var Post = storiesDB.model('Post', PostSchema, 'posts');

function deleteEmpty(v) {
    if (v == null || v.length == 0) {
        return undefined;
    }
    return v;
}

var WebsiteSchema = new mongoose.Schema({
  url: { type: String, unique: true },
  approved: { type: Boolean, default: true },
  rssSitemap: { type: [String], set: deleteEmpty },
  sitemaps: { type: [String], set: deleteEmpty },
  sitemeta: {
      title: {
          type: String,
      },
      description: {
          type: String
      }
  },
  category: { type: String, default: '' },
  crawlingTimestamp: { type: Date, default: Date.now },
  crawlingStatus: { type: String, default: '' },
  trust: { type: Number, default: 0 },
  twinglyId: { type: String }
});
var Website = sitemapsDB.model('Website', WebsiteSchema, 'websites');

sitemapsDB.on('error', console.error.bind(console, 'Connection error on mongoDB:'));
sitemapsDB.once('open', function (callback) {
  console.log("Connected to sitemaps database");
  Website.count({}, function( err, count){
    numberOfSitemaps = count;
    console.log( "Number of sitemaps: ", numberOfSitemaps );
  });
  Website.findOne().skip(1).sort({
      _id: 1
  }).exec(function(err, result) {
      console.log("Sitemaps: " + result.rssSitemap[0]);
      console.log(process.argv[2]);
      if(process.argv[2] > 0){
        console.log("Start at feed #: " + process.argv[2]);
        feedCount = process.argv[2];
      }
      else{
        if(numberOfSitemaps>0){
          feedCount = Math.floor(Math.random() * numberOfSitemaps);
          console.log("Start at feed #: " + feedCount);
        }
      }
  });
});

storiesDB.on('error', console.error.bind(console, 'Connection error on mongoDB:'));
storiesDB.once('open', function (callback) {
  console.log("Connected to stories database");
  Post.count({}, function( err, count){
    console.log( "Number of stories: ", count );
  });
  setTimeout(function() {
    callToFetch();
  }, 5000);
});

mlspotlight.configEndpoints(
  {
    "english": {
      host:'spotlight.sztaki.hu', //host: '130.211.172.192' // host:'10.240.238.78',
      path:'/rest/annotate',
      port:'2222',
      confidence:0.5,
      support:0
    }
  }
);

//fix to a specific endpoint (i.e. disabling language detection)
//mlspotlight.fixToEndpoint('english');
//unfix endpoint (i.e. enabling language detection)
//mlspotlight.unfixEndpoint();

var feedDBlength = numberOfSitemaps; //sitemaps database count
console.log("feedDBlength: " + feedDBlength);

var completeFeedRoundFlag = false;
var firstFeedRoundFlag = true;
var storyCount = 0;

function getNextFeedSource(){
  feedDBlength = numberOfSitemaps; //sitemaps database count
  console.log("feedDBlength: " + feedDBlength);
  feedCount++;
  if(feedCount >= (feedDBlength-1)) feedCount = -1;
  feedCount++;
  if(!firstFeedRoundFlag){
    if(feedCount==0){
      completeFeedRoundFlag = true;
      setTimeout(function() {
        completeFeedRoundFlag = false;
        feedCount = 0;
        Website.count({}, function( err, count){
          numberOfSitemaps = count; //Update number of Sitemaps
          console.log( "Number of sitemaps: ", numberOfSitemaps );
        });
        callToFetch();
      }, 900000); //-> 15 min
    }
  }
  firstFeedRoundFlag = false;
  console.log("Feed #" + feedCount + " date: " + new Date().toISOString());

  return feedCount;
}

var fetch = function(feed, callback) {
      console.log("Fecthing from: " + feed);
      var posts = new Array();
      var errorFeedParser = false;
      var options = {
        url: feed,
        // Some feeds do not response without user-agent and accept headers.
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.63 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml'
        },
        setMaxListeners: 50,
        timeout: 10000,
        pool: false
      };
      var req = request(options, function (error, response, body) {
        if(error){
            return callback(error, null);
        }
        if (!error) {
          //console.log(body)
        }
      });

      var feedparser = new FeedParser([{normalize:true, addmeta:false}]);
      // Define requeste handlers
      req.on('error', function(err) {
        if (err) {
          console.log(err);
          return callback(err, null);
        }
      });
      req.on('response', function(res) {
        posts = new Array();
        if (res.statusCode != 200){
          this.emit('error', new Error('Bad status code'));
          return callback(res.statusCode, null);
        }
        var encoding = res.headers['content-encoding'] || 'identity';
        var charset = getParams(res.headers['content-type'] || '').charset;
        res = maybeDecompress(res, encoding);
        res = maybeTranslate(res, charset);
        res.pipe(feedparser);
      });
      // Define feedparser handlers
      feedparser.on('error', function(err) {
        if (err) {
          console.log("feed error:" + err);
          errorFeedParser = true;
          return callback(err, null);
        }
      });
      feedparser.on('end', function(err){
        req.end();
        if(!errorFeedParser)return callback(null, posts);
        errorFeedParser = false;
      });
      feedparser.on('readable', function() {
          var post;
          while (post = this.read()) {
            posts.push(transToPost(post));//Save to an array of objects
          }
      });

      function maybeDecompress(res, encoding) {
        var decompress;
        try {
          if (encoding.match(/\bdeflate\b/)) {
            decompress = zlib.createInflate();
          } else if (encoding.match(/\bgzip\b/)) {
            decompress = zlib.createGunzip();
          }
          return decompress ? res.pipe(decompress) : res;
        } catch(err) {
          console.log(err);
          res.emit('error', err);
          return callback(err, null);
        }
      }

      function maybeTranslate(res, charset) {
        var iconv;
        // Use iconv if its not utf8 already.
        if (!iconv && charset && !/utf-*8/i.test(charset)) {
          try {
            iconv = new Iconv(charset, 'utf-8');
            console.log('Converting from charset %s to utf-8', charset);
            iconv.on('error', function(err) {
              if (err) {
                console.log(err);
                return callback(err, null);
              }
            });
            // If we're using iconv, stream will be the output of iconv
            // otherwise it will remain the output of request
            res = res.pipe(iconv);
          } catch(err) {
            console.log(err);
            res.emit('error', err);
            return callback(err, null);
          }
        }
        return res;
      }

      //Get RSS params, check content-type headers
      function getParams(str) {
        var params = str.split(';').reduce(function (params, param) {
          var parts = param.split('=').map(function (part) { return part.trim(); });
          if (parts.length === 2) {
            params[parts[0]] = parts[1];
          }
          return params;
        }, {});
        return params;
      }


      function transToPost(post){
          var pubDate = '';
          try {
              pubDate = (post.pubDate ? post.pubDate : post.date).toString().trim()
          } catch (e) {
              pubDate = '';
          }
          var updatedTime = new Date(Date.parse(pubDate)).getTime();
          updatedTime = parseInt(updatedTime);
          var url;
          if (post.origlink) url = post.origlink;
          else url = post.link;
          var mPost = new Post({
              title : striptags(post.title).replace("<![CDATA[", "").replace("]]>", "").replace("&#39;", "'").replace("&#39;", "'").replace("&#39;", "'").replace("&nbsp;", " ").replace("&nbsp;", " ").replace("&nbsp;", " ").replace("&mdash;", "-").replace("&mdash;", "-"),
              author : '' + post.author + '',
              description : striptags(post.description).replace("<![CDATA[", "").replace("]]>", "").replace("&#39;", "'").replace("&#39;", "'").replace("&#39;", "'").replace("&nbsp;", " ").replace("&nbsp;", " ").replace("&nbsp;", " ").replace("&mdash;", "-").replace("&mdash;", "-"),
              image : post.image.url,
              pubDate : pubDate,
              url : url,
              when : parseInt(updatedTime),
              source : post.source
          });
          return mPost;
      }
}


function saveStories(posts, callback){

  var iteration = function(post,callbackDone) {
    storyCount = storyCount + 1;
    console.log("Feed #" + feedCount + " Post #" + storyCount + " date: " + new Date().toISOString() + " " + post.title );
    Post.find( { $or: [ { url: post.url }, { title: post.title } ] },function(err, result){
      if(err){
          console.log(err);
          return callbackDone();
      }
      if(result==0) //Story is new then..
      {
        console.log("NEW!");
        //call Summarizer function
        console.log("URL:" + post.url);
        getSummary(post.url).then(function (data) {
          var input = post.description;
          var langdetected = langdetect.detectOne(input);
          console.log(langdetected);
          mlspotlight.annotate(input,function(output){
            var entities = new Array();
            if(input && output.response.Resources){
              var rawEntities = output.response.Resources;
              var entitiesLength = output.response.Resources.length;

              if(rawEntities && entitiesLength >= 1){
                entities = new Array();
                for(var i = 0; i < entitiesLength; i++ ){
                  entities[i] = rawEntities[i]["@surfaceForm"];
                }

                var arrayUnique = function(a) {
                    return a.reduce(function(p, c) {
                        if (p.indexOf(c) < 0) p.push(c);
                        return p;
                    }, []);
                };

                entities = arrayUnique(entities);
              }
              console.log(entities);
            }
            else {
              console.log("entities null");
            }
            //Get main image link from story
            var image = '';
            //Image Validation
            if (data.stats.ok == true) image = data.image;
            else image = post.image;
            image = striptags(image).replace("https:", "http:");
            //save to local mongoDB
            var storyToSave = new Post({
                title : post.title,
                author : post.author, //TODO: Author RSS description is generally/always null
                description : post.description,
                image : image,
                pubDate : post.pubDate,
                //summary : striptags(data.summary.toString()).replace("<![CDATA[", "").replace("]]>", ""), //TODO: should we store summary on Firebase?
                url : post.url,
                // url : post.link, // Was before
                words: data.stats.words,
                minutes: data.stats.minutes,
                sentiment: data.stats.sentiment,
                difficulty: data.stats.difficulty,
                //topics: data.stats.topics,
                topics: entities,
                analysis: data.stats.ok,
                when : post.when,
                source : post.source,
                language: langdetected
            });
            // Convert the Model instance to a simple object using Model's 'toObject' function
            // to prevent weirdness like infinite looping...
            var upsertStory = storyToSave.toObject();
            // Delete the _id property, otherwise Mongo will return a "Mod on _id not allowed" error
            delete upsertStory._id;
            delete upsertStory.__v;
            // Do the upsert, which works like this: If no Post document exists with
            // url = upsertStory.url or title = upsertStory.title, then create a new doc using upsertStory.
            // Otherwise, update the existing doc with upsertStory
            // This function stores only new RSS stories to the local mongoDb
            //Post.update({url: upsertStory.url}, upsertStory, {upsert: true}, function(err) {

            Post.update({ $and: [ { url: post.url }, { title: post.title } ] }, upsertStory, {upsert: true}, function(err,result) {
              if (err){
                console.log(err);
                return callbackDone();
              }
              if(result){
                console.log("STORY SAVED");
                return callbackDone();
              }
            });

          });

        }, function(err) {
          console.log("getSumaryError" + err)
          return callbackDone();
        });
      }
      else{  //Story is already stored then..
        console.log("OLD!");
        //Nothing to do
        return callback(null, storyCount);
        //return callbackDone();
      }
    });
  };

  async.eachSeries(posts, iteration, function (err) {
    return callback(null, storyCount);
  });

}

function callToFetch(){
  if(completeFeedRoundFlag==false) // If false then hasn't complete a Feed Round, if true then Feed Round has been completed.
  {
    async.waterfall([
      function(callback){
        var feedCount = getNextFeedSource();
        console.log("ASYNC WATERFALL Feedcount:" + feedCount)
        callback(null, feedCount);
      },
      function functionName(feedCount, callback) {
        Website.findOne().skip(feedCount).sort({
            _id: 1
        }).exec(function(err, result) {
            console.log("Sitemaps: " + result.rssSitemap[0]);
            console.log("Sitemaps: " + result);
            console.log("result.approved: " + result.approved);
            console.log("result.rssSitemap[0]: " + result.rssSitemap[0]);
            if(result.approved == true){ // only return appoved feeds
              if(!err) callback(null, result.rssSitemap[0]);
            }
            else{
              callback(null, '');
            }
            if(err) callback(err, '');
        });
      },
      function(feed, callback){
        fetch(feed, function(err, posts) {
          callback(err, posts);
        });
      },
      function(posts, callback){
        if(posts){
          storyCount = 0;
          saveStories(posts, function(err, storyCount) {
            callback(err, storyCount);
          });
        }
        else{
          callback(err, 0);
        }
      }
    ],
    function(err, results){
      console.log(err);
      callToFetch();
    });
  }
}

//Function that displays all stories stored on local mongoDB
function countAllMongoStories(){
  //Count total number of Storues on mongoDB
  Post.count(function(err, totalStories){
  if(err){
        console.error(err.stack);
        return;
    }
    else console.log("Total Stories: " + totalStories);
  });
}
//countAllMongoStories();
