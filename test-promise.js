class MyPromise {
  constructor(informer) {
    if (typeof informer !== 'function') {
      throw new TypeError('Promise resolver undefined is not a function')
    }
    this.isPromise = true // 方便判断是不是 promise 实例
    this.data = null // promise 的值,用于在决议后,启动操作时作为参数执行
    this.status = 'pending' // 状态只能由 pending => resolved 或者 pending => rejected
    this.onSuccessCallbacks = [] // 因为可以在决议时可执行多个函数,所以这里应该是数组
    this.onErrorCallbacks = []
    this.locked = false
    const openLock = (fn) => { // 用来为决定 promise 状态的 thenable 对象进行开锁
      this.locked = false
      return fn
    }
    // thenable 对象指的是具有 then 方法的对象或者函数,主要是便于兼容各种 promise 的实现
    // 原生的 Promise,如果构造函数 resolve 的是一个 thenable 对象,那么该 promise 的状态就由 thenable 对象决定,如果该 thenable 对象 resolve 的也是 thenable 对象,那么 promise 的状态由该 resolve 的 thenable 对象决定,直到非 thenable 为止。
    // 这个和 then 方法传入的函数中,如果返回值的也是一个 thenable 对象,那么该 then 方法返回的 promise 的状态的逻辑和上面的是一样的,变为取决于返回的 thenable 对象
    // 所以这里把主要逻辑都放在构造函数内的 resolve 中,可以对 then 方法返回的 thenable 对象和构造函数中 resolve 的 thenable 对象同时处理
    // 关于构造函数中如果 resolve 的是一个 thenable 的对象处理,不属于 A+ 规范的内容,这里主要和原生的保持一致
    // 由于考虑到构造函数 thenable 的问题,所以 promise 的状态变化,要等对应的 thenable 对象完成后才会改变 
    // 因为是递归操作,所以在处理 thenable 对象时会多次触发 resolve 方法或者是一次 reject 方法,由于在构造函数执行时或者是执行 thenbale 对象的
    // then 方法时,不能多次 resolve 和 reject,只有第一次会生效,但同时由于状态存在延迟改变的问题,所以不能通过简单的判断 status 来解决
    // 所以这里使用了一个 locked 来锁定状态,如果是 thenable 对象触发的,可以使用 openLock 方法暂时解锁状态
    // 由于对于 thenable 对象的触发是可以解锁状态的,对于 Promise 对象来说,resolve 封装在构造函数中,而且通过 locked 防止了多次触发,但是对于非 promise 
    // 的 thenable 对象来说,其 then 方法中还是可能触发多次 resolve 和 reject,而这些方法触发后会解锁状态导致多次触发,所以对于这些对象要在内部再多锁一层
    // 主要防止的是这种情况
    // new MyPromise((resolve, reject) => {
    //   resolve()
    //   resolve() // 使用 locked 锁定
    //   reject()
    // }).then(() => {
    //   return {
    //     then: function (resolve, reject) {
    //       resolve() // 这里执行方法后会决定 promise 的最终状态,所以为这些方法进行解锁,但是会了防止多次触发,在解锁时需要再次判断
    //       resolve() 
    //       reject()
    //     }
    //   }
    // })
    // 原生的 Promise 在状态改变后会在当前循环中的微任务中执行决议后的操作,这里用 setTimeout 进行模拟,保证操作是异步的
    // A+ 规范主要对 then 方法进行描述,其他方法没有提及
    // https://promisesaplus.com/#point-51 
    const resolve = value => {
      if (this.locked) {
        return
      }
      this.locked = true
      // 按照规范如果自身的变化取决于自身的变化,应该抛出一个 TypeError
      if (value === this) {
        return openLock(reject)(new TypeError('存在循环引用'))
      }
      if (value && value.isPromise) {
        return value.then(openLock(resolve), openLock(reject))
      }
      // 这里是为了兼容非 promise 的 thenable 对象,其 then 方法和传入构造函数的 informer 的处理基本一致
      if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      // 这里还是要锁定的,因为 locked 只能锁构造函数的多次 resolve 或者 reject,但是如果是 then 函数,按这种写法也会通过
      // openLock 来多次写入 resolve 和 reject,所以在这里要开启多一层锁
        let called = false 
        try {
          let then = value.then
          if (typeof then === 'function') {
            return then.call(value, function (value) {
              if (called) {
                return
              }
              called = true
              openLock(resolve)(value) // 解锁操作,虽然已经在之前执行了 resolve，但是通过解锁可以继续执行 resolve,当值不是 thenable 对象时 promise 才会改变状态,不然会一直进行异步递归
            }, function (error) {
              if (called) {
                return
              }
              called = true
              openLock(reject)(error)
            })
          }
        } catch (error) {
          if (called) {
            return
          }
          called = true
          return openLock(reject)(error)
        }
      }
      // 上面的操作要带上 return,这样可以让 promise 实例的状态改变延长到值是 thenable 对象的改变
      this.status = 'resolved'
      this.data = value
      setTimeout(() => {
        this.onSuccessCallbacks.forEach(successCallback => {
          successCallback(value)
        })
      })
    }

    // reject 的操作和 resolve 稍有不同, reject 返回的值,即使是 thenable 对象也会立即返回,所以状态可以立即改变,因此没有 resolve 那么复杂
    const reject = error => {
      if (this.locked) {
        return
      }
      this.locked = true
      this.status = 'rejected'
      this.data = error
      setTimeout(() => {
        this.onErrorCallbacks.forEach(errorCallback => {
          errorCallback(error)
        })
      })
    }
    try {
      informer(resolve, reject)
    } catch (error) {
      reject(error)
    }
  }
  then(successCallback, errorCallback) {
    // 这里主要保证,当前存入的不是一个函数时,前面 promise 的值可以一直往后传递
    // 错误操作应该要抛出前面的错误,如果是 return error,该 error 传入到下一个成功操作的回调中
    successCallback = typeof successCallback === 'function' ? successCallback : function (value) {
      return value
    }
    errorCallback = typeof errorCallback === 'function' ? errorCallback : function (error) {
      throw error
    }
    return new MyPromise((resovle, reject) => {
    // 如果调用的 promise 已经是决议状态,那么操作应该尽快执行,并且传递 promise 的值
      if (this.status === 'resolved') {
        setTimeout(() => {
          let value = null
          try {
            value = successCallback(this.data)
          } catch (error) {
            return reject(error)
          }
          resovle(value)
        })
      }
      if (this.status === 'rejected') {
        setTimeout(() => {
          let value = null
          try {
            value = errorCallback(this.data)
          } catch (error) {
            return reject(error)
          }
          resovle(value)
        })
      }
      // 如果 promise 还没有在决议状态,暂时把操作保存好,等决议后执行
      if (this.status === 'pending') {
        this.onSuccessCallbacks.push(function (value) {
          let data = null
          try {
      // 操作可能会发生错误,这些错误应该被捕获
            data = successCallback(value)
          } catch (error) {
            return reject(error)
          }
      // 这里的 resolve reject,是 then 方法返回的新的 promise 时生成的,用来决定新的 promise 的状态 
      // 如果 data 是 thenable 对象,会执行递归操作
          resovle(data)
        })

        this.onErrorCallbacks.push(function (error) {
          let data = null
          try {
            data = errorCallback(error)
          } catch (error) {
            return reject(error)
          }
          resovle(data)
        })
      }
    })
  }
  catch(errorCallback) {
    return this.then(null, errorCallback)
  } 
  static resolve(value) {
    if (value && value.isPromise) {
      return value
    }
    if (value !== null && (typeof value === 'object' || typeof value === 'function') ) {
      try {
        let then = value.then
        if (typeof then === 'function') {
          return new MyPromise(then.bind(value))
        }
      } catch (error) {
        return new MyPromise((resolve, reject) => {
          reject(error)
        })
      }
    }
    let p = new MyPromise(() => {})
    p.status = 'resolved'
    p.data = value
    return p
  }
  static reject(value) {
    return new MyPromise((resolve, reject) => {
      reject(value)
    })
  }
  static race(values) {
    return new MyPromise((resolve, reject) => {
      [...values].forEach((value) => {
        Promise.resolve(value).then(resolve, reject)
      })
    })
  }
  static all(values) {
    values = [...values]
    return new MyPromise((resolve, reject) => {
      let length = values.length
      if (length === 0) {
        resolve([])
      }
      let count = 0
      let result = []
      values.forEach((value, index) => {
        Promise.resolve(value).then((value) => {
          count++
          result[index] = value
          if (count === length) {
            resolve(result)
          }
        }, reject)
      })
    })
  }
}

// 用于测试程序 npm run test
MyPromise.defer = MyPromise.deferred = function(){
  let dfd = {};
  dfd.promise = new MyPromise((resolve,reject)=>{
      dfd.resolve = resolve;
      dfd.reject = reject;
  });
  return dfd;
}

module.exports = MyPromise


