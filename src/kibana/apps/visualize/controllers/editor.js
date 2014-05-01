define(function (require) {
  var _ = require('lodash');
  var ConfigTemplate = require('utils/config_template');
  var typeDefs = require('../saved_visualizations/_type_defs');

  require('../saved_visualizations/saved_visualizations');
  require('notify/notify');

  var app = require('modules').get('app/visualize', [
    'kibana/notify',
    'kibana/courier'
  ]);

  var aggs = require('../saved_visualizations/_aggs');
  var visConfigCategories = require('../saved_visualizations/_config_categories');

  var getVisAndFieldsHash = function (savedVisualizations, courier, Notifier, $location, $route) {
    return function (using) {
      return savedVisualizations.get(using)
      .then(function (vis) {
        // get the fields before we render, but return the vis
        return vis.searchSource.getFields()
        .then(function (fields) {
          return [vis, fields];
        });
      })
      .catch(function (e) {
        if (e instanceof courier.errors.SavedObjectNotFound) {
          new Notifier({location: 'Dashboard'}).error(e.message);
          $location.path('/visualize');
          $route.reload(); // force $route to be recomputed and prevent the controller from being loaded.
        } else {
          throw e;
        }
      });
    };
  };

  require('routes')
  .when('/visualize/create', {
    template: require('text!../editor.html'),
    resolve: {
      visAndFieldsHash: function ($injector, $route) {
        return $injector.invoke(getVisAndFieldsHash)($route.current.params);
      }
    }
  })
  .when('/visualize/edit/:id', {
    template: require('text!../editor.html'),
    resolve: {
      visAndFieldsHash: function ($injector, $route) {
        return $injector.invoke(getVisAndFieldsHash)($route.current.params.id);
      }
    }
  });

  app.controller('VisualizeEditor', function ($scope, $route, Notifier, config, $location, savedVisualizations, AppState, timefilter) {
    var notify = new Notifier({
      location: 'Visualization Editor'
    });

    // get the vis loaded in from the routes
    var vis = $route.current.locals.visAndFieldsHash[0];
    // vis.destroy called by visualize directive

    var fieldsHash = $route.current.locals.visAndFieldsHash[1];

    var $state = new AppState(vis.getState());

    // get the current field list
    // create a sorted list of the fields for display purposes
    $scope.fields = _(fieldsHash)
      .keys()
      .sort()
      .transform(function (fields, name) {
        var field = fieldsHash[name];
        field.name = name;
        fields.push(field);
      })
      .value();
    $scope.fields.byName = fieldsHash;

    $scope.vis = vis;
    $scope.aggs = aggs;
    $scope.visConfigCategories = visConfigCategories;

    var visConfigProperties = Object.keys(visConfigCategories.byName);

    /**
     * Write the latest changes made on the visualization to the $state. This
     * will cause a fetch if there were changes
     *
     * @return {Array} - a list of the keys from state that were updated.
     */
    var writeStateAndFetch = function () {
      vis.writeAggs();
      _.assign($state, vis.getState());
      $state.commit();
      vis.searchSource.fetch();
    };

    /**
     * Pull the state into the vis, and then fetch the searchSource
     * @return {undefined}
     */
    var readStateAndFetch = function () {
      // update and commit the state, which will update the vis dataSource if there were new changes
      vis.setState($state);
      vis.writeAggs();
      vis.searchSource.fetch();
    };

    /**
     * When something else updates the state, let us know
     */
    $state.onUpdate(readStateAndFetch);

    /**
     * Click handler for the "refresh" button
     */
    $scope.doVisualize = writeStateAndFetch;

    /**
     * Click handler for the "new doc" button
     */
    $scope.startOver = function () {
      $location.url('/visualize');
    };

    /**
     * Do that actual save, click handler for the "save" button within the save config panel
     */
    $scope.doSave = function () {
      writeStateAndFetch();

      // use the title for the id
      vis.id = vis.title;

      // serialize the current state
      vis.stateJSON = JSON.stringify(vis.getState());

      vis.save()
      .then(function () {
        $location.url('/visualize/edit/' + vis.id);
        configTemplate.close('save');
      }, notify.fatal);
    };


    /**
     * Enable the timefilter, and tell Angular to
     */
    timefilter.enabled(true);
    $scope.timefilter = timefilter;
    $scope.$watchCollection('timefilter.time', $scope.doVisualize);

    // config panel templates
    var configTemplate = $scope.configTemplate = new ConfigTemplate({
      save: require('text!../partials/save.html'),
      load: require('text!../partials/load.html')
    });

    /**
     * Click handler for the "save" button.
     */
    $scope.toggleSave = _.bindKey(configTemplate, 'toggle', 'save');

    /**
     * Toggle the load config panel
     */
    $scope.toggleLoad = _.bindKey(configTemplate, 'toggle', 'load');

    // objects to make available within the config panel's scope
    $scope.conf = _.pick($scope, 'doSave', 'vis');

    // init
    readStateAndFetch();
  });
});