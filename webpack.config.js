const path = require('path')

const EsmWebpackPlugin = require('@purtuga/esm-webpack-plugin')

const clientFiles = [
  'video-edit-client-plugin',
  'video-watch-client-plugin',
  'common-client-plugin'
]

const config = clientFiles.map(f => ({
  // mode: 'production',
  devtool: process.env.NODE_ENV === 'dev' ? 'eval-source-map' : false,
  entry: './client/' + f + '.ts',
  output: {
    path: path.resolve(__dirname, './dist/client'),
    filename: './' + f + '.js',
    library: 'script',
    libraryTarget: 'var'
  },
  plugins: [new EsmWebpackPlugin()],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader'
      }
    ]
  },
  resolve: {
    alias: {
      shared: path.resolve(__dirname, 'shared/')
    },
    extensions: ['.ts']
  }
}))

module.exports = config
