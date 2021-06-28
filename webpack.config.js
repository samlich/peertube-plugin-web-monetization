const path = require('path')

const EsmWebpackPlugin = require('@purtuga/esm-webpack-plugin')

const clientFiles = [
  'video-edit-client-plugin.js',
  'video-watch-client-plugin.js',
  'common-client-plugin.js'
]

const config = clientFiles.map(f => ({
  mode: 'production',
  entry: './client/' + f,
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: './' + f,
    library: 'script',
    libraryTarget: 'var'
  },
  plugins: [new EsmWebpackPlugin()],
  module: {
    rules: [
      {
        test: /\.js$/,
        use: [
          'ify-loader',
          'transform-loader?plotly.js/tasks/compress_attributes.js'
        ]
      }
    ]
  }
}))

module.exports = config
