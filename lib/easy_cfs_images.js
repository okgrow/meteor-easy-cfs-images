/*

USAGE
=====

The following creates a new FS.Collection named "myImages" with four sizes:
1. The original image
2. "thumbnail" at 300x300
3. "normal" at 800x400
4. "superGiant" at 4096x4096

var factory = new ImageCollectionFactory(myAccessKeyId, mySecretAccessKey, myBucketName);
MyImages = factory.createImageCollection("myImages", {
  thumbnail: [300, 300],
  normal: [800, 400],
  superGiant: [4096, 4096]
});

ImageCollectionFactory can optionally take an options parameter. If you want to
server images directly from S3 do the following:

var factory = new ImageCollectionFactory(
  myAccessKeyId,
  mySecretAccessKey,
  myBucketName,
  {
    publicRead: true,
    bucketRegion: eu-west-1 // optional, leave blank for default region
  }
);

*/

ImageCollectionFactory = function (accessKeyId, secretAccessKey, bucketName, options) {
  var MAX_FILE_SIZE = 1024 * 1024 * 10; // 10 MB
  var factory = this;

  //Set Cache Control headers so we don't overload our meteor server with http requests
  FS.HTTP.setHeadersForGet([['Cache-Control', 'public, max-age=31536000']]);

  var region = (options && options.bucketRegion) || "";
  if (region) {
    region = "-"+region;
  }
  factory.bucketUrl = "https://"+bucketName+region+".s3.amazonaws.com/";
  var publicRead = options && options.publicRead;
  var acl = publicRead ? 'public-read' : 'private';

  factory.stores = [];

  // sizes looks like {thumbnail: [100, 100], normal: [200,300]}
  // there will also be one named "original" containing the original image at
  // full size
  this.createImageCollection = function (collectionName, sizes) {
    factory.stores.push(
      new FS.Store.S3(collectionName + "-original", {
        bucket: bucketName,
        folder: collectionName + "-original",
        ACL: acl,
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      })
    );

    _.each(sizes, function (dimensions, sizeName) {
      var x, y, store;

      x = dimensions[0];
      y = dimensions[1];

      store = new FS.Store.S3 ((collectionName + "-" + sizeName), {
        bucket: bucketName, //required
        folder: collectionName + "-" + sizeName,
        ACL: acl,
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,

        //Create the thumbnail as we save to the store.
        transformWrite: function (fileObj, readStream, writeStream) {
          /* Use graphicsmagick to create a XXxYY square thumbnail at 100% quality,
          * orient according to EXIF data if necessary and then save by piping to the
          * provided writeStream */
          if (gm.isAvailable) {
            gm(readStream, fileObj.name)
              .resize(x,y,"^")
              .gravity('Center').
              crop(x, y).
              quality(100).
              autoOrient().
              stream().pipe(writeStream);
          } else {
            console.warn("GraphicsMagick/ImageMagick not available");
          }
        }
      });
      factory.stores.push(store);
    });

    var collection = new FS.Collection (collectionName, {
      stores: factory.stores,
      filter: {
          maxSize: MAX_FILE_SIZE,
          allow: {
              contentTypes: ['image/*'],
              extensions: ['png', 'jpg', 'jpeg', 'gif']
          },
          onInvalid: function (message) {
              if(Meteor.isClient){
                  alert(message);
              }else{
                  console.warn(message);
              }
          }
      }
    });

    return collection;
  };

  if (publicRead && factory.bucketUrl) {
    // Save the old url method
    FS.File.prototype._url = FS.File.prototype.url;

    // New direct-to-S3 url method
    FS.File.prototype.url = function(options) {
      var self = this;

      var store = options && options.store;

      // Use the old url() method to reactively show S3 URL only when file is
      // is stored.
      // TODO: figure out a less hacky way. Use hasStored()?
      if (self._url(options)) {
        var fileKey = store + '/' + self.collectionName + '/' + self._id + '-' + self.name();
        return factory.bucketUrl + fileKey;
      }
      return null;
    }
  }

};

EasyImages = (function() {

  function required(options, name) {
    if (options[name]) {
      return options[name];
    }
    throw new Meteor.Error("Missing required parameter '"+name+"' for EasyImages configuration");
  }

  return {
    configure: function(options) {
      this.imageCollectionFactory = required(options, 'imageCollectionFactory');
    },
    bucketUrl: function() {
      return this.imageCollectionFactory.bucketUrl;
    }
  };
})();
